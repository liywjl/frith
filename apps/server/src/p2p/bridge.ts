// P2P workspace bridge: connects this Lore instance to peer instances over
// Hyperswarm. Public-channel messages fan out to peers as signed frames;
// verified incoming frames are written into the local database and pushed to
// local clients — so the full Lore UI (channels, threads, Ask) works across
// instances with no server between them.
//
// v0 scope, on purpose:
// - public channels only (DMs and private channels never leave the instance)
// - live messages only (no history backfill yet)
// - remote authors map by handle (shared seed) or are created on arrival
// - cross-instance thread mapping is in-memory (restart loses parent links
//   for new replies to old roots; they arrive as top-level messages)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Hyperswarm, { type SwarmSocket } from 'hyperswarm';
import hypercoreCrypto from 'hypercore-crypto';
import b4a from 'b4a';
import { and, eq, isNull } from 'drizzle-orm';
import type { MessageDto } from '@app/shared';
import { db } from '../db/client.js';
import { channels, users } from '../db/schema.js';
import { createMessage } from '../store.js';
import { publish } from '../realtime.js';

export interface WireFrame {
  type: 'message';
  origin: string; // sender instance public key (hex)
  globalId: string; // `${origin-of-first-writer}:${their-local-id}`
  globalParent: string | null;
  channel: string; // public channel name
  topic: string | null;
  authorHandle: string;
  authorName: string;
  body: string;
  ts: number;
  sig: string;
}

/** Everything a signature vouches for. */
function canonical(frame: Omit<WireFrame, 'sig'>): string {
  return [
    frame.origin,
    frame.globalId,
    frame.globalParent ?? '',
    frame.channel,
    frame.authorHandle,
    frame.authorName,
    frame.ts,
    frame.body,
  ].join('|');
}

export function signFrame(frame: Omit<WireFrame, 'sig'>, secretKey: Buffer): WireFrame {
  const sig = b4a.toString(hypercoreCrypto.sign(b4a.from(canonical(frame)), secretKey), 'hex');
  return { ...frame, sig };
}

export function verifyFrame(frame: WireFrame): boolean {
  try {
    return hypercoreCrypto.verify(
      b4a.from(canonical(frame)),
      b4a.from(frame.sig, 'hex'),
      b4a.from(frame.origin, 'hex'),
    );
  } catch {
    return false;
  }
}

interface BridgeState {
  me: string;
  secretKey: Buffer;
  swarm: Hyperswarm;
  connections: Set<SwarmSocket>;
  globalToLocal: Map<string, string>;
  localToGlobal: Map<string, string>;
}

let state: BridgeState | null = null;

export function connectedPeers(): number {
  return state?.connections.size ?? 0;
}

function loadIdentity(dataDir: string) {
  const file = path.join(dataDir, 'identity.json');
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as { publicKey: string; secretKey: string };
    return { publicKey: b4a.from(saved.publicKey, 'hex'), secretKey: b4a.from(saved.secretKey, 'hex') };
  }
  const pair = hypercoreCrypto.keyPair();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      publicKey: b4a.toString(pair.publicKey, 'hex'),
      secretKey: b4a.toString(pair.secretKey, 'hex'),
    }),
    { mode: 0o600 },
  );
  return pair;
}

function sendFrame(socket: SwarmSocket, frame: WireFrame) {
  socket.write(b4a.from(`${JSON.stringify(frame)}\n`));
}

async function acceptFrame(frame: WireFrame) {
  if (!state) return;
  if (frame.origin === state.me) return;
  if (!verifyFrame(frame)) {
    console.warn(`[p2p] rejected forged frame claiming ${frame.authorHandle}`);
    return;
  }
  if (state.globalToLocal.has(frame.globalId)) return; // already have it

  // Public channel by name — created on first sight so channels propagate.
  let [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.name, frame.channel), eq(channels.type, 'public'), isNull(channels.archivedAt)));
  if (!channel) {
    [channel] = await db
      .insert(channels)
      .values({ name: frame.channel, type: 'public', topic: frame.topic })
      .returning();
    publish({ type: 'channels.changed' }, 'all');
  }

  // Author by handle — with a shared seed both sides know the same people;
  // unknown authors are provisioned on arrival.
  let [author] = await db.select().from(users).where(eq(users.handle, frame.authorHandle));
  if (!author) {
    [author] = await db
      .insert(users)
      .values({ handle: frame.authorHandle, name: frame.authorName })
      .returning();
  }

  const parentLocal = frame.globalParent ? (state.globalToLocal.get(frame.globalParent) ?? null) : null;
  const message = await createMessage({
    channelId: channel!.id,
    authorId: author!.id,
    body: frame.body,
    parentMessageId: parentLocal,
  });
  state.globalToLocal.set(frame.globalId, message.id);
  state.localToGlobal.set(message.id, frame.globalId);
  publish({ type: 'message.created', message }, 'all');
}

export async function startBridge(room: string, dataDir: string): Promise<void> {
  if (state) return; // one space per instance for now
  if (process.env.NODE_ENV === 'test') return; // no DHT in unit tests
  const identity = loadIdentity(dataDir);
  const swarm = new Hyperswarm();
  state = {
    me: b4a.toString(identity.publicKey, 'hex'),
    secretKey: identity.secretKey,
    swarm,
    connections: new Set(),
    globalToLocal: new Map(),
    localToGlobal: new Map(),
  };

  swarm.on('connection', (socket) => {
    state!.connections.add(socket);
    console.log(`[p2p] peer connected (${state!.connections.size} total)`);
    publish({ type: 'p2p.peers', count: state!.connections.size }, 'all');
    let buffer = '';
    socket.on('data', (data: Buffer) => {
      buffer += b4a.toString(data);
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try {
          void acceptFrame(JSON.parse(line) as WireFrame);
        } catch {
          // ignore malformed frames
        }
      }
    });
    const drop = () => {
      state?.connections.delete(socket);
      console.log(`[p2p] peer disconnected (${state?.connections.size ?? 0} total)`);
      publish({ type: 'p2p.peers', count: state?.connections.size ?? 0 }, 'all');
    };
    socket.on('close', drop);
    socket.on('error', drop);
  });

  const topic = crypto.createHash('sha256').update(`lore-p2p-workspace:${room}`).digest();
  await swarm.join(topic, { server: true, client: true }).flushed();
  console.log(`[p2p] bridge up — room "${room}", identity ${state.me.slice(0, 12)}…`);
}

/** Called by the message route after a local post to a public channel. */
export function broadcastLocalMessage(
  message: MessageDto,
  channel: { name: string; type: string; topic: string | null },
  author: { handle: string; name: string },
): void {
  if (!state || channel.type !== 'public') return;
  const globalId = state.localToGlobal.get(message.id) ?? `${state.me}:${message.id}`;
  state.localToGlobal.set(message.id, globalId);
  state.globalToLocal.set(globalId, message.id);
  const globalParent = message.parentMessageId
    ? (state.localToGlobal.get(message.parentMessageId) ?? `${state.me}:${message.parentMessageId}`)
    : null;
  const frame = signFrame(
    {
      type: 'message',
      origin: state.me,
      globalId,
      globalParent,
      channel: channel.name,
      topic: channel.topic,
      authorHandle: author.handle,
      authorName: author.name,
      body: message.body,
      ts: Date.now(),
    },
    state.secretKey,
  );
  for (const socket of state.connections) sendFrame(socket, frame);
}
