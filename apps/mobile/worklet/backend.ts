// The mobile "server": the same space/ (Autobase P2P core) and domain/ layers
// the desktop app runs, with the Fastify HTTP edge replaced by an RPC router
// over BareKit IPC. Auth follows the desktop's production posture — this
// device IS the credential, so every request acts as the device's bound user
// (profiles.create / identity.import bind one). ACL checks mirror routes.ts.
import fs from 'node:fs';
import type { PoliciesDto, ServerEvent, SpaceDto } from '@app/shared';
import { space } from '../../server/src/space/space.js';
import { seedDemoSpaces } from './seed-demo.js';
import {
  addAttachment,
  addChannelMember,
  blockedIds,
  canReadChannel,
  cancelScheduled,
  channelAudience,
  clearExpiredStatuses,
  connectSuggestions,
  createChannel,
  createDoc,
  createMessage,
  createProfile,
  getAttachment,
  getChannel,
  getDoc,
  getHome,
  getMe,
  getMessage,
  getOrCreateGroup,
  getProfilePage,
  getThread,
  getUserByHandle,
  getUserById,
  listChannelMembers,
  listChannelMessages,
  listDocs,
  listFiles,
  listScheduled,
  listUsers,
  markChannelRead,
  parseInvite,
  removeChannelMember,
  removeDoc,
  reorderPins,
  scheduleMessage,
  setBlocked,
  setChannelArchived,
  setPinned,
  toggleReaction,
  toMessageDto,
  updateDoc,
  updateProfile,
  userDtoById,
  visibleChannels,
} from '../../server/src/domain/store.js';
import { ask } from '../../server/src/domain/ask.js';
import { autoFetchAttachments, fetchAttachmentBytes } from '../../server/src/domain/attachments.js';
import { deliverDueScheduled } from '../../server/src/domain/scheduler.js';
import { getPolicies, mb, setPolicies, storageDto } from '../../server/src/domain/policies.js';
import { effectiveMime } from '../../server/src/domain/files.js';

export class RpcError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const bad = (message: string) => new RpcError('bad-request', message);
const notFound = (message: string) => new RpcError('not-found', message);
const forbidden = (message: string) => new RpcError('forbidden', message);

/* ----------------------------- tiny validation ----------------------------- */
// The HTTP edge used zod; over the in-process pipe a lean checker keeps the
// worklet bundle small while failing malformed calls just as loudly.

function obj(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) throw bad('params must be an object');
  return params as Record<string, unknown>;
}

function str(v: unknown, name: string, opts: { max?: number; min?: number } = {}): string {
  if (typeof v !== 'string') throw bad(`${name} must be a string`);
  const { min = 1, max = 10_000 } = opts;
  if (v.length < min || v.length > max) throw bad(`${name} must be ${min}–${max} characters`);
  return v;
}

function optStr(v: unknown, name: string, max = 10_000): string | undefined {
  if (v === undefined || v === null) return undefined;
  return str(v, name, { min: 0, max });
}

function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') throw bad(`${name} must be a boolean`);
  return v;
}

function int(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw bad(`${name} must be an integer in [${min}, ${max}]`);
  }
  return v;
}

/* --------------------------------- backend --------------------------------- */

export interface Backend {
  handle(method: string, params: unknown): Promise<unknown>;
  onEvent(listener: (event: ServerEvent) => void): void;
  close(): Promise<void>;
}

export function createBackend(): Backend {
  const listeners: ((event: ServerEvent) => void)[] = [];
  const timers: ReturnType<typeof setInterval>[] = [];
  let opened = false;
  /** Dev-mode acting user — the mobile stand-in for the desktop dev cookie.
   *  Only honoured outside production; seeded demo users have no device
   *  identity to bind, exactly like desktop's pick-a-user flow. */
  let devUserId: string | null = null;

  const DEV = () => process.env.FRITH_MODE !== 'production';

  const emit = (event: ServerEvent) => {
    for (const l of listeners) l(event);
  };

  /** The device's acting user: in production the bound identity, in dev/seeded
   *  the dev-login selection — the same split as routes.ts (prod = bound user,
   *  dev = cookie). Dev must NOT fall back to the bound identity: seeding binds
   *  this device to the demo space's owner to set up the management chain, so
   *  the pick-a-user picker would otherwise boot signed-in as the owner.
   *  createProfile/import set devUserId explicitly in dev, like the desktop
   *  cookie. */
  const viewer = (): string | null => {
    const uid = DEV() ? devUserId : space.boundUserId();
    if (!uid) return null;
    const user = space.state.users.get(uid);
    return user && !space.state.evicted.has(uid) ? uid : null;
  };

  const requireUser = (): string => {
    const uid = viewer();
    if (!uid) throw new RpcError('unauthorized', 'no profile bound to this device yet');
    return uid;
  };

  const requireAccess = async (userId: string, channelId: string): Promise<void> => {
    if (!(await canReadChannel(userId, channelId))) throw forbidden('no access to this channel');
  };

  /** Look up a channel by `p.id` or fail like the HTTP edge would. */
  const channelById = async (p: Record<string, unknown>) => {
    const id = str(p.id, 'id', { max: 40 });
    const channel = await getChannel(id);
    if (!channel) throw notFound('no such channel');
    return { id, channel };
  };

  /** A channel the caller may post to right now: access + not archived. */
  const writableChannel = async (uid: string, p: Record<string, unknown>) => {
    const channelId = str(p.channelId, 'channelId', { max: 40 });
    await requireAccess(uid, channelId);
    const channel = await getChannel(channelId);
    if (channel?.archivedAt) throw new RpcError('conflict', 'this channel is archived');
    return { channelId, channel: channel! };
  };

  /** Mirror of routes.ts's spaceDto — the invite only reaches managers. */
  const spaceDto = (viewerId: string | null): SpaceDto => ({
    name: space.state.spaceName ?? space.name,
    description: space.state.spaceDescription,
    logoUrl: null, // the mobile client fetches logo bytes over RPC instead
    demo: false,
    invite: space.canManage(viewerId) ? space.invite() : null,
    connectedPeers: space.connectedPeers(),
    ownerUserId: space.state.ownerUserId,
    adminUserIds: [...space.state.admins],
    canManage: space.canManage(viewerId),
    isOwner: space.isOwner(viewerId),
    historyVisibility: space.state.historyVisibility,
    devAuth: false,
  });

  /** Everything the UI needs to route on launch (and after space switches). */
  const hello = async () => {
    const uid = viewer();
    return {
      me: uid ? await getMe(uid) : null,
      space: spaceDto(uid),
      spaces: space.listSpaces(),
      policies: getPolicies(),
      dev: DEV(),
    };
  };

  /** One user per device: forward an event only if this device may see it. */
  const deliver = (event: ServerEvent, audience: 'all' | string[]) => {
    const uid = viewer();
    if (audience === 'all' || (uid !== null && audience.includes(uid))) emit(event);
  };

  /** The op → ServerEvent fan-out, verbatim from the desktop's buildApp(). */
  const wireFanout = () => {
    space.onOp((op) => {
      void (async () => {
        if (op.t === 'msg') {
          deliver(
            { type: 'message.created', message: toMessageDto(op.message, viewer() ?? '') },
            await channelAudience(op.message.channelId),
          );
          void autoFetchAttachments(op.message, {
            blockedLocally: (authorId) => {
              const uid = viewer();
              return uid !== null && (space.state.blocks.get(uid)?.has(authorId) ?? false);
            },
            publish: deliver,
          });
        } else if (op.t === 'react') {
          const message = await getMessage(op.messageId);
          if (!message) return;
          deliver(
            {
              type: 'reaction.changed',
              channelId: message.channelId,
              messageId: op.messageId,
              emoji: op.emoji,
              userId: op.userId,
              added: op.on,
            },
            await channelAudience(message.channelId),
          );
        } else if (op.t === 'user') {
          const user = userDtoById(op.id);
          if (user) deliver({ type: 'user.updated', user }, 'all');
        } else if (op.t === 'channel' || op.t === 'archive' || op.t === 'member' || op.t === 'unmember') {
          deliver({ type: 'channels.changed' }, 'all');
        } else if (op.t === 'doc') {
          deliver({ type: 'docs.changed', docId: op.doc.id }, 'all');
        } else if (op.t === 'doc-remove') {
          deliver({ type: 'docs.changed', docId: op.docId }, 'all');
        }
      })();
    });
    space.onPeers((count) => deliver({ type: 'p2p.peers', count }, 'all'));
  };

  async function init(params: unknown) {
    const p = obj(params);
    const dataDir = str(p.dataDir, 'dataDir', { max: 1024 });
    const seeded = p.seeded === true;
    if (opened) return hello();
    // Device-local policies live beside the space data, like on desktop.
    process.env.FRITH_DATA = dataDir;
    // Seeded = the desktop's dev:seeded semantics: a throwaway dir wiped and
    // re-seeded with the three demo spaces on every launch, dev pick-a-user
    // auth instead of device identity.
    process.env.FRITH_MODE = seeded ? 'dev' : (process.env.FRITH_MODE ?? 'production');
    if (seeded) fs.rmSync(dataDir, { recursive: true, force: true });
    await space.open(dataDir);
    if (seeded) await seedDemoSpaces(); // before fan-out wiring — seed ops aren't realtime news
    wireFanout();
    // Same timers start.ts runs: status expiry sweep + schedule-send delivery.
    timers.push(
      setInterval(() => {
        void clearExpiredStatuses().then((cleared) => {
          for (const user of cleared) deliver({ type: 'user.updated', user }, 'all');
        });
      }, 30_000),
      setInterval(() => void deliverDueScheduled(), 15_000),
    );
    opened = true;
    return hello();
  }

  async function handle(method: string, params: unknown): Promise<unknown> {
    if (method === 'init') return init(params);
    if (!opened) throw new RpcError('not-ready', 'call init first');

    switch (method) {
      /* ——— pre-login surface (mirrors routes.ts's publicSurface) ——— */
      case 'hello':
        return hello();
      case 'users.list':
        return listUsers();
      // Dev auth (seeded builds only): act as a seeded user, like the desktop
      // dev cookie. Absent in production, same as routes.ts's /api/dev/*.
      case 'dev.login': {
        if (!DEV()) throw forbidden('dev login is not available in production');
        const p = obj(params);
        const user = await getUserByHandle(str(p.handle, 'handle', { max: 40 }));
        if (!user) throw notFound('no such user');
        devUserId = user.id;
        return hello();
      }
      case 'dev.logout': {
        if (!DEV()) throw forbidden('dev login is not available in production');
        devUserId = null;
        return hello();
      }
      case 'profiles.create': {
        const p = obj(params);
        const result = await createProfile({
          name: str(p.name, 'name', { max: 80 }).trim(),
          handle: str(p.handle, 'handle', { max: 40 }).trim(),
          avatarEmoji: optStr(p.avatarEmoji, 'avatarEmoji', 16) ?? null,
        });
        if (result === 'invalid-handle') throw bad('handles are letters, numbers, and dashes');
        if (result === 'handle-taken') throw new RpcError('conflict', 'that handle is taken in this space');
        // createProfile binds this device (prod reads that via boundUserId);
        // in dev, mirror the desktop cookie so the new profile is signed in.
        if (DEV()) devUserId = result.id;
        return hello();
      }
      case 'identity.import': {
        const p = obj(params);
        const code = str(p.code, 'code', { max: 200 }).trim();
        const match = /^frith-id:([0-9a-f-]{36}):([0-9a-f]{64})$/.exec(code);
        if (!match) throw bad('that does not look like an identity code');
        const [, userId, seed] = match;
        if (!(await getUserById(userId!))) throw notFound('no such user in this space');
        try {
          await space.bindLocalDevice(userId!, seed!);
        } catch (err) {
          throw bad(err instanceof Error ? err.message : 'could not bind this device');
        }
        if (DEV()) devUserId = userId!; // dev parity with the desktop cookie
        return hello();
      }
      case 'space.get':
        return spaceDto(viewer());
      case 'spaces.list':
        return space.listSpaces();
      case 'spaces.switch': {
        const p = obj(params);
        try {
          await space.switchSpace(str(p.dir, 'dir', { max: 120 }));
        } catch (err) {
          throw notFound(err instanceof Error ? err.message : 'no such space');
        }
        return hello();
      }
      case 'space.create': {
        const p = obj(params);
        await space.createSpace(str(p.name, 'name', { max: 60 }).trim());
        return hello();
      }
      case 'space.join': {
        const p = obj(params);
        const parsed = parseInvite(str(p.invite, 'invite', { max: 400 }));
        if (!parsed) throw bad('that does not look like a Frith invite');
        try {
          await space.joinSpace(parsed.name, parsed.inviteHex);
        } catch (err) {
          throw new RpcError('timeout', err instanceof Error ? err.message : 'pairing failed');
        }
        return hello();
      }
    }

    /* ——— everything below acts as the device's bound user ——— */
    const uid = requireUser();

    switch (method) {
      case 'me.get':
        return getMe(uid);
      case 'me.update': {
        const p = obj(params);
        return updateProfile(uid, {
          name: optStr(p.name, 'name', 80),
          title: p.title === null ? null : optStr(p.title, 'title', 80),
          team: p.team === null ? null : optStr(p.team, 'team', 80),
          avatarEmoji: p.avatarEmoji === null ? null : optStr(p.avatarEmoji, 'avatarEmoji', 16),
          statusEmoji: p.statusEmoji === null ? null : optStr(p.statusEmoji, 'statusEmoji', 16),
          statusText: p.statusText === null ? null : optStr(p.statusText, 'statusText', 120),
          statusExpiresInMinutes:
            p.statusExpiresInMinutes === undefined
              ? undefined
              : p.statusExpiresInMinutes === null
                ? null
                : int(p.statusExpiresInMinutes, 'statusExpiresInMinutes', 1, 10_080),
          interests: Array.isArray(p.interests)
            ? p.interests.slice(0, 12).map((i, n) => str(i, `interests[${n}]`, { max: 40 }).trim())
            : undefined,
          nowPlaying: p.nowPlaying === null ? null : optStr(p.nowPlaying, 'nowPlaying', 120),
        });
      }
      case 'identity.export': {
        const seed = space.identitySeed(uid);
        if (!seed) throw notFound('this device does not hold your identity seed');
        return { code: `frith-id:${uid}:${seed}` };
      }
      case 'users.block': {
        const p = obj(params);
        const target = str(p.userId, 'userId', { max: 40 });
        if (target === uid) throw bad('you cannot block yourself');
        return { blockedUserIds: await setBlocked(uid, target, bool(p.on, 'on')) };
      }
      case 'users.profile': {
        const p = obj(params);
        const profile = await getProfilePage(uid, str(p.userId, 'userId', { max: 40 }));
        if (!profile) throw notFound('no such user');
        return profile;
      }

      /* ——— space management ——— */
      case 'space.rename': {
        const p = obj(params);
        if (!space.canManage(uid)) throw forbidden('only owner or admins can change space settings');
        await space.renameSpace(str(p.name, 'name', { max: 60 }), uid);
        return spaceDto(uid);
      }
      case 'space.describe': {
        const p = obj(params);
        if (!space.canManage(uid)) throw forbidden('only owner or admins can change space settings');
        await space.setDescription(str(p.description, 'description', { min: 0, max: 280 }), uid);
        return spaceDto(uid);
      }
      case 'space.history': {
        const p = obj(params);
        const value = str(p.value, 'value', { max: 20 });
        if (value !== 'full' && value !== 'join-forward') throw bad('value must be full or join-forward');
        if (!space.isOwner(uid)) throw forbidden('only the owner changes space settings');
        await space.setHistoryVisibility(value, uid);
        return spaceDto(uid);
      }
      case 'space.admin': {
        const p = obj(params);
        if (!space.isOwner(uid)) throw forbidden('only the owner manages admins');
        try {
          await space.setAdmin(str(p.userId, 'userId', { max: 40 }), bool(p.admin, 'admin'), uid);
        } catch (err) {
          throw forbidden(err instanceof Error ? err.message : 'cannot update admin');
        }
        return spaceDto(uid);
      }
      case 'space.evict': {
        const p = obj(params);
        if (!space.canManage(uid)) throw forbidden('only owner or admins can remove members');
        try {
          await space.evictUser(str(p.userId, 'userId', { max: 40 }), uid);
        } catch (err) {
          throw forbidden(err instanceof Error ? err.message : 'cannot remove member');
        }
        return { ok: true };
      }

      /* ——— channels ——— */
      case 'channels.list':
        return visibleChannels(uid);
      case 'channels.create': {
        const p = obj(params);
        const type = str(p.type, 'type', { max: 10 });
        if (type !== 'public' && type !== 'private') throw bad('type must be public or private');
        const result = await createChannel(uid, {
          name: str(p.name, 'name', { max: 80 }),
          type,
          topic: optStr(p.topic, 'topic', 250) ?? null,
        });
        if (result === 'invalid-name') throw bad('channel name is invalid');
        if (result === 'name-taken') throw new RpcError('conflict', 'a channel with that name already exists');
        return { channelId: result.id };
      }
      case 'channels.archive': {
        const p = obj(params);
        const { id, channel } = await channelById(p);
        if (channel.type === 'dm') throw bad('conversations cannot be archived');
        // Read access alone isn't enough for a public channel: everyone in the
        // space has it, so gating on it lets anyone freeze any public channel.
        // Public channels are space-wide (managers only); private ones belong
        // to their members. Same policy as the HTTP edge — one op, one rule.
        if (channel.type === 'public') {
          if (!space.canManage(uid)) throw forbidden('only owner or admins can archive this channel');
        } else {
          await requireAccess(uid, id);
        }
        await setChannelArchived(id, bool(p.archived, 'archived'));
        return { ok: true };
      }
      case 'channels.read': {
        const p = obj(params);
        const id = str(p.id, 'id', { max: 40 });
        await requireAccess(uid, id);
        await markChannelRead(uid, id);
        return { ok: true };
      }
      case 'channels.members': {
        const p = obj(params);
        const id = str(p.id, 'id', { max: 40 });
        await requireAccess(uid, id);
        return listChannelMembers(id);
      }
      case 'channels.members.add': {
        const p = obj(params);
        const { id, channel } = await channelById(p);
        if (channel.type === 'public') throw bad('everyone in the space is already here');
        await requireAccess(uid, id);
        const result = await addChannelMember(id, str(p.userId, 'userId', { max: 40 }));
        if (result === 'no-user') throw notFound('no such person');
        return listChannelMembers(id);
      }
      case 'channels.members.remove': {
        const p = obj(params);
        const { id, channel } = await channelById(p);
        if (channel.type === 'public') throw bad('public channels have no member list');
        await requireAccess(uid, id);
        await removeChannelMember(id, str(p.userId, 'userId', { max: 40 }));
        return listChannelMembers(id);
      }

      /* ——— messages ——— */
      case 'messages.list': {
        const p = obj(params);
        const channelId = str(p.channelId, 'channelId', { max: 40 });
        await requireAccess(uid, channelId);
        return listChannelMessages(channelId, uid);
      }
      case 'messages.send': {
        const p = obj(params);
        const { channelId } = await writableChannel(uid, p);
        return createMessage({
          channelId,
          authorId: uid,
          body: str(p.body, 'body', { max: 10_000 }),
          parentMessageId: optStr(p.parentMessageId, 'parentMessageId', 40) ?? null,
        });
      }
      case 'messages.thread': {
        const p = obj(params);
        const rootId = str(p.rootId, 'rootId', { max: 40 });
        const root = await getMessage(rootId);
        if (!root) throw notFound('no such message');
        await requireAccess(uid, root.channelId);
        return getThread(rootId, uid);
      }
      case 'messages.react': {
        const p = obj(params);
        const messageId = str(p.messageId, 'messageId', { max: 40 });
        const message = await getMessage(messageId);
        if (!message) throw notFound('no such message');
        await requireAccess(uid, message.channelId);
        return { added: await toggleReaction(uid, messageId, str(p.emoji, 'emoji', { max: 16 })) };
      }
      case 'messages.schedule': {
        const p = obj(params);
        const { channelId } = await writableChannel(uid, p);
        return scheduleMessage({
          authorId: uid,
          channelId,
          body: str(p.body, 'body', { max: 10_000 }),
          sendAt: new Date(Date.now() + int(p.inMinutes, 'inMinutes', 1, 10_080) * 60_000),
        });
      }

      /* ——— DMs & groups ——— */
      case 'dms.open': {
        const p = obj(params);
        const otherId = str(p.userId, 'userId', { max: 40 });
        if (otherId === uid) throw bad('that is you');
        if (!(await getUserById(otherId))) throw notFound('no such user');
        if ((await blockedIds(uid)).includes(otherId)) throw forbidden('you have blocked this person');
        if ((await blockedIds(otherId)).includes(uid)) throw forbidden('this person is not accepting messages from you');
        return { channelId: await getOrCreateGroup(uid, [otherId]) };
      }
      case 'groups.create': {
        const p = obj(params);
        if (!Array.isArray(p.userIds) || p.userIds.length < 2 || p.userIds.length > 8) {
          throw bad('userIds must list 2–8 people');
        }
        const userIds = p.userIds.map((u, n) => str(u, `userIds[${n}]`, { max: 40 }));
        if (userIds.includes(uid)) throw bad('you are already in it');
        try {
          return { channelId: await getOrCreateGroup(uid, userIds) };
        } catch {
          throw notFound('unknown user in group');
        }
      }

      /* ——— knowledge surfaces ——— */
      case 'home.get':
        return getHome(uid);
      case 'connect.get':
        return connectSuggestions(uid);
      case 'ask': {
        const p = obj(params);
        return ask(uid, str(p.q, 'q', { min: 0, max: 500 }));
      }

      /* ——— files: base64 over RPC — mobile has no arbitrary FS access ——— */
      case 'files.list':
        return listFiles(uid);
      case 'files.get': {
        const p = obj(params);
        const id = str(p.id, 'id', { max: 40 });
        const attachment = await getAttachment(id);
        if (!attachment) throw notFound('no such file');
        await requireAccess(uid, attachment.channelId);
        if (!attachment.blob) throw notFound('file is not on this device'); // pre-blob legacy uploads live on desktop disks
        const result = await fetchAttachmentBytes({ ...attachment, blob: attachment.blob }, p.wait === true, deliver);
        if (result.status === 'needs-fetch') {
          return { needsFetch: true, name: attachment.name, mime: attachment.mime, size: attachment.size, base64: null };
        }
        if (result.status === 'locked') throw forbidden('you no longer have access to this file');
        return {
          needsFetch: false,
          name: attachment.name,
          mime: attachment.mime,
          size: attachment.size,
          base64: result.clear.toString('base64'),
        };
      }
      case 'attachments.send': {
        const p = obj(params);
        const { channelId, channel } = await writableChannel(uid, p);
        const bytes = Buffer.from(str(p.base64, 'base64', { max: 200 * 1024 * 1024 }), 'base64');
        if (bytes.length > mb(getPolicies().maxUploadMB)) {
          throw bad(`files are capped at ${getPolicies().maxUploadMB} MB here`);
        }
        const messageId = space.newId();
        const mime = effectiveMime(bytes, str(p.mime, 'mime', { max: 120 }));
        await space.ensureDomainKey(space.contentDomain(channel.type, channelId), uid);
        await addAttachment(messageId, channelId, str(p.name, 'name', { max: 200 }), mime, bytes);
        return createMessage({
          id: messageId,
          channelId,
          authorId: uid,
          body: optStr(p.caption, 'caption', 10_000) ?? '',
          parentMessageId: optStr(p.parentMessageId, 'parentMessageId', 40) ?? null,
        });
      }

      /* ——— docs ——— */
      case 'docs.list':
        return listDocs();
      case 'docs.get': {
        const p = obj(params);
        const doc = await getDoc(str(p.id, 'id', { max: 40 }));
        if (!doc) throw notFound('no such doc');
        return doc;
      }
      case 'docs.create': {
        const p = obj(params);
        return createDoc(uid, str(p.title, 'title', { max: 120 }).trim());
      }
      case 'docs.update': {
        const p = obj(params);
        const doc = await updateDoc(uid, str(p.id, 'id', { max: 40 }), {
          title: optStr(p.title, 'title', 120),
          body: optStr(p.body, 'body', 200_000),
        });
        if (!doc) throw notFound('no such doc');
        return doc;
      }
      case 'docs.remove': {
        const p = obj(params);
        const result = await removeDoc(uid, str(p.id, 'id', { max: 40 }));
        if (result === 'no-doc') throw notFound('no such doc');
        if (result === 'forbidden') throw forbidden('only the creator or a manager can remove a doc');
        return { ok: true };
      }

      /* ——— device-local storage ——— */
      case 'storage.get':
        return storageDto(space.blobs.usage());
      case 'storage.policies': {
        const p = obj(params);
        const patch: Partial<PoliciesDto> = {};
        if (p.maxUploadMB !== undefined) patch.maxUploadMB = int(p.maxUploadMB, 'maxUploadMB', 1, 4096);
        if (p.autoFetchMB !== undefined) patch.autoFetchMB = int(p.autoFetchMB, 'autoFetchMB', 0, 4096);
        if (p.autoFetchRecentDays !== undefined) {
          patch.autoFetchRecentDays = int(p.autoFetchRecentDays, 'autoFetchRecentDays', 0, 3650);
        }
        if (p.storageBudgetMB !== undefined) patch.storageBudgetMB = int(p.storageBudgetMB, 'storageBudgetMB', 0, 1_048_576);
        const policies = setPolicies(patch);
        await space.blobs.enforceBudget(mb(policies.storageBudgetMB));
        return storageDto(space.blobs.usage());
      }
      case 'storage.clearCache':
        await space.blobs.clearCache();
        return storageDto(space.blobs.usage());

      /* ——— pins & scheduled ——— */
      case 'pins.set': {
        const p = obj(params);
        const channelId = str(p.channelId, 'channelId', { max: 40 });
        await requireAccess(uid, channelId);
        await setPinned(uid, channelId, bool(p.pinned, 'pinned'));
        return { ok: true };
      }
      case 'pins.reorder': {
        const p = obj(params);
        if (!Array.isArray(p.channelIds) || p.channelIds.length > 50) throw bad('channelIds must list at most 50 channels');
        await reorderPins(uid, p.channelIds.map((c, n) => str(c, `channelIds[${n}]`, { max: 40 })));
        return { ok: true };
      }
      case 'scheduled.list':
        return listScheduled(uid);
      case 'scheduled.cancel': {
        const p = obj(params);
        if (!(await cancelScheduled(uid, str(p.id, 'id', { max: 40 })))) throw notFound('not found');
        return { ok: true };
      }

      case 'debug.get':
        return space.debug();

      default:
        throw new RpcError('unknown-method', `unknown method: ${method}`);
    }
  }

  return {
    handle,
    onEvent(listener) {
      listeners.push(listener);
    },
    async close() {
      for (const t of timers) clearInterval(t);
      await space.close();
    },
  };
}
