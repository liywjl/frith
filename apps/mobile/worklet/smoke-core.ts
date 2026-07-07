// The smoke scenario, transport-agnostic: drive the backend through the same
// serve() loop production uses, over an in-memory pipe. Run by smoke.ts under
// Node (tsx) and by smoke-bare.ts under the actual Bare runtime.
import type { ChannelDto, MessageDto, ServerEvent, UserDto } from '@app/shared';
import { FrameDecoder, encodeFrame } from '../common/protocol.js';
import { createBackend, RpcError } from './backend.js';
import { serve, type IpcLike } from './serve.js';

class Pipe implements IpcLike {
  private listeners: ((chunk: Uint8Array) => void)[] = [];
  peer: Pipe | null = null;
  on(_event: 'data', listener: (chunk: Uint8Array) => void): void {
    this.listeners.push(listener);
  }
  write(chunk: Uint8Array): void {
    // Deliver async and in two arbitrary slices — exercises frame reassembly.
    const split = Math.min(3, chunk.byteLength);
    queueMicrotask(() => {
      for (const l of this.peer!.listeners) l(chunk.subarray(0, split));
      for (const l of this.peer!.listeners) l(chunk.subarray(split));
    });
  }
}

function assert(cond: unknown, label: string): asserts cond {
  if (!cond) throw new Error(`SMOKE FAIL: ${label}`);
  console.log(`ok — ${label}`);
}

/** A backend served over an in-memory pipe, plus the client to talk to it. */
function connect() {
  const [ui, worklet] = [new Pipe(), new Pipe()];
  ui.peer = worklet;
  worklet.peer = ui;

  const backend = createBackend();
  serve(backend, worklet, { FrameDecoder, encodeFrame, RpcError });

  const decoder = new FrameDecoder();
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const events: ServerEvent[] = [];
  let nextId = 1;

  ui.on('data', (chunk) => {
    for (const frame of decoder.push(chunk)) {
      const f = frame as { id?: number; ok?: boolean; result?: unknown; error?: string; event?: ServerEvent };
      if (f.event) {
        events.push(f.event);
      } else if (typeof f.id === 'number') {
        const p = pending.get(f.id)!;
        pending.delete(f.id);
        if (f.ok) p.resolve(f.result);
        else p.reject(new Error(f.error));
      }
    }
  });

  const call = <T = unknown>(method: string, params?: unknown): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ui.write(encodeFrame({ id, method, params }));
    });

  return { backend, call, events };
}

export async function runSmoke(dataDir: string): Promise<void> {
  const { backend, call, events } = connect();

  // ——— the scenario: a founder's phone, end to end ———
  const helloBefore = await call<{ me: unknown }>('init', { dataDir });
  assert(helloBefore.me === null, 'fresh device has no bound profile');

  await call('users.list').then((users) => assert(Array.isArray(users) && users.length === 0, 'fresh space is empty'));

  const denied = await call('channels.list').then(
    () => null,
    (err: Error) => err.message,
  );
  assert(denied !== null, `auth guard rejects pre-profile calls (${denied})`);

  const helloAfter = await call<{ me: { id: string; handle: string }; space: { canManage: boolean; invite: string | null } }>(
    'profiles.create',
    { name: 'Ada Lovelace', handle: 'ada', avatarEmoji: '🧮' },
  );
  assert(helloAfter.me?.handle === 'ada', 'profile created and bound to this device');
  assert(helloAfter.space.canManage && helloAfter.space.invite?.startsWith('frith:'), 'founder holds the invite');

  const { channelId } = await call<{ channelId: string }>('channels.create', { name: 'general', type: 'public' });
  const channels = await call<ChannelDto[]>('channels.list');
  assert(channels.some((c) => c.id === channelId && c.name === 'general'), 'channel listed');

  const sent = await call<MessageDto>('messages.send', { channelId, body: 'hello from the phone' });
  assert(sent.body === 'hello from the phone', 'message sent and decrypted back');

  const listed = await call<MessageDto[]>('messages.list', { channelId });
  assert(listed.length === 1 && listed[0]!.body === 'hello from the phone', 'message listed (sealed in the log, clear over RPC)');

  await call('messages.react', { messageId: sent.id, emoji: '🎉' });
  const relisted = await call<MessageDto[]>('messages.list', { channelId });
  assert(relisted[0]!.reactions.some((r) => r.emoji === '🎉' && r.mine), 'reaction toggled');

  // Attachments: base64 over RPC — the mobile file story (no arbitrary FS).
  const bytes = 'JVBERi0='; // "%PDF-" magic, base64 — sniffs as application/pdf
  const attMsg = await call<MessageDto>('attachments.send', {
    channelId,
    name: 'notes.pdf',
    mime: 'application/pdf',
    base64: bytes,
    caption: 'the notes',
  });
  assert(attMsg.attachments.length === 1 && attMsg.attachments[0]!.name === 'notes.pdf', 'attachment sent');
  const file = await call<{ base64: string | null; mime: string }>('files.get', { id: attMsg.attachments[0]!.id });
  assert(file.base64 === bytes, 'attachment bytes round-trip (sealed blob, decrypted back)');

  // Threads + a second member via DM machinery need another user; the private
  // channel path exercises the per-domain content keys.
  const priv = await call<{ channelId: string }>('channels.create', { name: 'secret-plans', type: 'private' });
  await call('messages.send', { channelId: priv.channelId, body: 'locked to members' });
  const privList = await call<MessageDto[]>('messages.list', { channelId: priv.channelId });
  assert(privList[0]!.body === 'locked to members', 'private channel message readable by its member');

  const me = await call<UserDto & { id: string }>('me.get');
  const exported = await call<{ code: string }>('identity.export');
  assert(exported.code.startsWith(`frith-id:${me.id}:`), 'identity exports for device linking');

  const home = await call<{ unread: unknown[] }>('home.get');
  assert(Array.isArray(home.unread), 'home digest computes');

  const askResult = await call<{ messages: { snippet: string }[] }>('ask', { q: 'phone hello' });
  assert(askResult.messages.length >= 1, 'ask retrieval finds the message');

  const debug = await call<{ writable: boolean; viewLength: number }>('debug.get');
  assert(debug.writable && debug.viewLength > 0, `autobase writable, ${debug.viewLength} ops in the view`);

  assert(
    events.some((e) => e.type === 'message.created'),
    'realtime fan-out pushed message.created over IPC',
  );

  await backend.close();
  console.log('\nsmoke: all assertions passed');
}

/** The seeded demo boot: three spaces, dev pick-a-user auth — `pnpm
 *  ios:seeded`'s backend, minus the phone. */
export async function runSeededSmoke(dataDir: string): Promise<void> {
  const { backend, call } = connect();

  type Hello = { dev: boolean; me: { handle: string } | null; space: { name: string }; spaces: { spaces: { name: string }[] } };
  const hello = await call<Hello>('init', { dataDir, seeded: true });
  assert(hello.dev && hello.me === null, 'seeded boot is dev mode with nobody signed in');
  assert(hello.space.name === 'Acme', 'boots into the Acme demo space');
  const names = hello.spaces.spaces.map((s) => s.name);
  assert(
    ['Acme', 'Blade Crew 🛼', 'Static Bloom 🎸'].every((n) => names.includes(n)),
    'all three demo spaces seeded',
  );

  const users = await call<UserDto[]>('users.list');
  assert(users.length >= 10, `demo users exist (${users.length})`);

  const asTomas = await call<Hello>('dev.login', { handle: 'tomas' });
  assert(asTomas.me?.handle === 'tomas', 'dev login as Tomas Novak');

  const channels = await call<ChannelDto[]>('channels.list');
  const incident = channels.find((c) => c.name === 'incident-4021');
  assert(incident && incident.unreadCount > 0, 'Tomas has fresh unreads in #incident-4021');

  const messages = await call<MessageDto[]>('messages.list', { channelId: incident.id });
  assert(messages.length > 0 && messages[0]!.body.length > 0, 'seeded messages read back');

  const home = await call<{ unread: unknown[] }>('home.get');
  assert(home.unread.length > 0, 'home digest surfaces the catch-up');

  const out = await call<Hello>('dev.logout');
  assert(out.me === null, 'dev logout returns to the picker');

  await backend.close();
  console.log('\nsmoke (seeded): all assertions passed');
}
