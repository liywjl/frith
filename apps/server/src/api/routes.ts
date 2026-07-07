import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import { THEMES } from '@app/shared';
import {
  addAttachment,
  addChannelMember,
  blockedIds,
  createDoc,
  createProfile,
  getDoc,
  listDocs,
  listChannelMembers,
  listFiles,
  removeDoc,
  removeChannelMember,
  updateDoc,
  canReadChannel,
  getAttachment,
  channelAudience,
  connectSuggestions,
  createChannel,
  createMessage,
  getChannel,
  getMessage,
  getHome,
  getOrCreateGroup,
  getProfilePage,
  getThread,
  getUserByHandle,
  getUserById,
  listChannelMessages,
  listUsers,
  cancelScheduled,
  listScheduled,
  markChannelRead,
  parseInvite,
  reorderPins,
  scheduleMessage,
  createUser,
  setBlocked,
  setPinned,
  setChannelArchived,
  toggleReaction,
  toMessageDto,
  updateProfile,
  userDtoById,
  visibleChannels,
} from '../domain/store.js';
import { ask, taskScope } from '../domain/ask.js';
import { onlineUserIds, publish, register, sendToUser, setOnUserOffline } from './realtime.js';
import { activeCalls, joinCall, leaveAllCalls, leaveCall, setRecording } from '../domain/calls.js';
import { getPolicies, setPolicies, mb } from '../domain/policies.js';
import { effectiveMime, isDangerousName } from '../domain/files.js';
import { space } from '../space/space.js';
import { seedCorpus } from '../domain/seed.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

const AUTH_COOKIE = 'uid';

// Production (packaged desktop / deployed): no dev routes, and requests act
// as the device's bound user — the server binds 127.0.0.1 in-process, so the
// loopback plus the OS user is the trust boundary; a cookie adds nothing.
// Dev keeps the pick-a-user cookie flow for fast local iteration.
const PROD = () => process.env.FRITH_MODE === 'production';

let fanoutWired = false;

/** ACL guard: 403s and returns false if the user may not read the channel. */
async function requireChannelAccess(
  req: FastifyRequest,
  reply: FastifyReply,
  channelId: string,
): Promise<boolean> {
  if (await canReadChannel(req.userId, channelId)) return true;
  await reply.code(403).send({ error: 'no access to this channel' });
  return false;
}

/**
 * Warm the local cache for a just-arrived message's files — within this
 * device's policies, and never for authors someone at this device blocked.
 */
async function autoFetchAttachments(message: { id: string; channelId: string; authorId: string; createdAt: string }) {
  const policies = getPolicies();
  const attachments = space.state.attachmentsByMessage.get(message.id) ?? [];
  const tooOld = Date.now() - new Date(message.createdAt).getTime() > policies.autoFetchRecentDays * 86_400_000;
  const blockedLocally = onlineUserIds().some((uid) => space.state.blocks.get(uid)?.has(message.authorId));
  if (tooOld || blockedLocally) return;
  for (const a of attachments) {
    if (!a.blob || space.blobs.isOwn(a.blob) || a.size > mb(policies.autoFetchMB)) continue;
    const bytes = await space.blobs.get(a.blob, { wait: true, expectedHash: a.hash }).catch(() => null);
    if (!bytes) continue;
    publish(
      { type: 'file.cached', channelId: message.channelId, messageId: message.id, attachmentId: a.id },
      await channelAudience(message.channelId),
    );
  }
  await space.blobs.enforceBudget(mb(policies.storageBudgetMB));
}

export async function buildApp() {
  if (!space.isOpen) await space.open(process.env.FRITH_DATA ?? '.frith-data');

  // One fan-out for every applied op — local writes and remote peers' writes
  // reach connected websocket clients the same way.
  if (!fanoutWired) {
    fanoutWired = true;
    space.onOp((op) => {
      void (async () => {
        if (op.t === 'msg') {
          publish(
            { type: 'message.created', message: toMessageDto(op.message, '') },
            await channelAudience(op.message.channelId),
          );
          void autoFetchAttachments(op.message);
        } else if (op.t === 'react') {
          const message = await getMessage(op.messageId);
          if (!message) return;
          publish(
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
          if (user) publish({ type: 'user.updated', user }, 'all');
        } else if (op.t === 'channel' || op.t === 'archive' || op.t === 'member' || op.t === 'unmember') {
          publish({ type: 'channels.changed' }, 'all');
        } else if (op.t === 'doc') {
          publish({ type: 'docs.changed', docId: op.doc.id }, 'all');
        } else if (op.t === 'doc-remove') {
          publish({ type: 'docs.changed', docId: op.docId }, 'all');
        }
      })();
    });
    space.onPeers((count) => publish({ type: 'p2p.peers', count }, 'all'));
  }

  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  // Malformed input is the caller's fault, not a server fault: answer 400
  // with the field names only — never the raw Zod internals.
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof z.ZodError) {
      const fields = [...new Set(err.issues.map((i) => i.path.join('.') || 'body'))].join(', ');
      return reply.code(400).send({ error: `invalid request: ${fields}` });
    }
    return reply.code(err.statusCode ?? 500).send({ error: err.statusCode ? err.message : 'something went wrong' });
  });
  await app.register(cookie);
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  // The desktop app (and any static deploy) serves the built web client from
  // the same origin — the client's relative /api URLs just work.
  const webDist = process.env.FRITH_WEB_DIST;
  if (webDist && fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: path.resolve(webDist) });
  }
  const filesDir = process.env.FRITH_FILES ?? path.join('.data', 'uploads');
  fs.mkdirSync(filesDir, { recursive: true });

  // Dev auth: pick a seeded user by handle, get a cookie — local iteration
  // speed wins. Absent in production builds (the preHandler ignores cookies
  // there anyway; unregistering keeps the surface honest).
  if (!PROD()) {
    app.post('/api/dev/login', async (req, reply) => {
      const body = z.object({ handle: z.string() }).parse(req.body);
      const user = await getUserByHandle(body.handle);
      if (!user) return reply.code(404).send({ error: 'no such user' });
      reply.setCookie(AUTH_COOKIE, user.id, { path: '/' });
      return { id: user.id, handle: user.handle, name: user.name };
    });
  }

  app.get('/api/users', async () => listUsers());

  // Create a brand-new profile in this space and sign in as it — the path
  // for someone who just joined via an invite.
  app.post('/api/profiles', async (req, reply) => {
    const input = z
      .object({
        name: z.string().trim().min(1).max(80),
        handle: z.string().trim().min(1).max(40),
        avatarEmoji: z.string().trim().max(16).nullable().optional(),
      })
      .parse(req.body);
    const result = await createProfile(input);
    if (result === 'invalid-handle') return reply.code(400).send({ error: 'handles are letters, numbers, and dashes' });
    if (result === 'handle-taken') return reply.code(409).send({ error: 'that handle is taken in this space' });
    reply.setCookie(AUTH_COOKIE, result.id, { path: '/' });
    return { id: result.id, handle: result.handle, name: result.name };
  });

  // Back to the profile picker. In production this is a no-op (identity is
  // device-bound, not cookie-bound) — switching users there means linking a
  // different identity, not logging out.
  app.post('/api/logout', async (_req, reply) => {
    reply.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Everything below requires auth. The pre-login surface is enumerated
  // EXACTLY — a fresh instance must join/see a space before any user exists,
  // but privileged space routes (evict, admins, settings) always need a user.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return; // static web client — the API guards the data
    const path = req.url.split('?')[0]!;
    // Pre-login surface: pick/create a profile, link a device, see/join/create
    // a space. Everything else under /api/space* falls through to auth.
    if (
      (!PROD() && req.url.startsWith('/api/dev/')) ||
      path === '/api/users' ||
      path === '/api/profiles' ||
      path === '/api/identity/import' ||
      path === '/api/logout' ||
      path === '/api/spaces' ||
      (path === '/api/space' && req.method !== 'PATCH') ||
      path === '/api/space/logo' && req.method === 'GET' ||
      path === '/api/space/join' ||
      path === '/api/spaces/switch'
    )
      return;
    // Production: this device IS the credential — requests act as its bound
    // user. Dev: whoever the cookie says.
    const uid = PROD() ? space.boundUserId() : req.cookies[AUTH_COOKIE];
    const user = uid ? await getUserById(uid) : null;
    if (!user) return reply.code(401).send({ error: 'not logged in' });
    // An evicted user's row survives (their messages keep an author), but
    // their credential must not: a stale cookie is not a way back in.
    if (space.state.evicted.has(user.id)) return reply.code(401).send({ error: 'not logged in' });
    req.userId = user.id;
  });

  // ——— Identity: export/import moves a root seed between YOUR devices ———

  // The handoff code is the raw root seed: render it as a QR / copy it, out
  // of band. It never touches the log; both ends store it encrypted.
  app.get('/api/identity/export', async (req, reply) => {
    const seed = space.identitySeed(req.userId);
    if (!seed) return reply.code(404).send({ error: 'this device does not hold your identity seed' });
    return { code: `frith-id:${req.userId}:${seed}` };
  });

  // Second device (already a space member via the normal invite flow):
  // paste the code, prove the seed matches the on-log root, act as the user.
  app.post('/api/identity/import', async (req, reply) => {
    const { code } = z.object({ code: z.string().trim() }).parse(req.body);
    const match = /^frith-id:([0-9a-f-]{36}):([0-9a-f]{64})$/.exec(code);
    if (!match) return reply.code(400).send({ error: 'that does not look like an identity code' });
    const [, userId, seed] = match;
    if (!(await getUserById(userId!))) return reply.code(404).send({ error: 'no such user in this space' });
    try {
      await space.bindLocalDevice(userId!, seed!);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'could not bind this device' });
    }
    reply.setCookie(AUTH_COOKIE, userId!, { path: '/' }); // dev parity; prod ignores cookies
    return { userId };
  });

  app.post('/api/identity/devices/revoke', async (req, reply) => {
    const { deviceKey } = z.object({ deviceKey: z.string().regex(/^[0-9a-f]{64}$/) }).parse(req.body);
    try {
      await space.revokeDevice(req.userId, deviceKey);
    } catch (err) {
      return reply.code(403).send({ error: err instanceof Error ? err.message : 'cannot revoke' });
    }
    return { ok: true };
  });

  app.get('/api/me', async (req) => {
    const me = (await getUserById(req.userId))!;
    const expired = me.statusExpiresAt !== null && new Date(me.statusExpiresAt) < new Date();
    return {
      ...me,
      statusEmoji: expired ? null : me.statusEmoji,
      statusText: expired ? null : me.statusText,
      statusExpiresAt: expired ? null : me.statusExpiresAt,
      blockedUserIds: await blockedIds(req.userId),
    };
  });

  // viewerId is undefined on the pre-login surface (GET /api/space, join,
  // create) — manager flags simply come back false there.
  const spaceDto = (viewerId: string | undefined) => ({
    // state.spaceName is the log's source of truth (converges across peers);
    // space.name is the local registry fallback before any rename op.
    name: space.state.spaceName ?? space.name,
    description: space.state.spaceDescription,
    logoUrl: space.state.spaceLogo ? `/api/space/logo?v=${space.state.spaceLogo.hash.slice(0, 12)}` : null,
    invite: space.invite(),
    connectedPeers: space.connectedPeers(),
    ownerUserId: space.state.ownerUserId,
    adminUserIds: [...space.state.admins],
    // Authorization follows the ACTING user (the request), not the device's
    // bound profile — in dev they can differ.
    canManage: space.canManage(viewerId),
    isOwner: space.isOwner(viewerId),
    historyVisibility: space.state.historyVisibility,
  });

  app.get('/api/space', async (req) => spaceDto(req.userId));

  // Remove a member from the whole space: revoke their devices, rotate every
  // content key they could read, and rotate the invite everywhere.
  app.post('/api/space/evict', async (req, reply) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    if (!space.canManage(req.userId)) return reply.code(403).send({ error: 'only owner or admins can remove members' });
    try {
      await space.evictUser(userId, req.userId);
    } catch (err) {
      return reply.code(403).send({ error: err instanceof Error ? err.message : 'cannot remove member' });
    }
    return { ok: true };
  });

  // Owner grants/revokes admin.
  app.post('/api/space/admins', async (req, reply) => {
    const { userId, admin } = z.object({ userId: z.string().uuid(), admin: z.boolean() }).parse(req.body);
    if (!space.isOwner(req.userId)) return reply.code(403).send({ error: 'only the owner manages admins' });
    try {
      await space.setAdmin(userId, admin, req.userId);
    } catch (err) {
      return reply.code(403).send({ error: err instanceof Error ? err.message : 'cannot update admin' });
    }
    return { ok: true };
  });

  // Owner sets whether newcomers can read pre-join history.
  app.post('/api/space/history', async (req, reply) => {
    const { value } = z.object({ value: z.enum(['full', 'join-forward']) }).parse(req.body);
    if (!space.isOwner(req.userId)) return reply.code(403).send({ error: 'only the owner changes space settings' });
    await space.setHistoryVisibility(value, req.userId);
    return spaceDto(req.userId);
  });

  // Managers (owner or admin) rename the space and edit its description.
  app.patch('/api/space', async (req, reply) => {
    const { name, description } = z
      .object({
        name: z.string().trim().min(1).max(60).optional(),
        description: z.string().trim().max(280).optional(),
      })
      .parse(req.body);
    if (!space.canManage(req.userId)) return reply.code(403).send({ error: 'only owner or admins can change space settings' });
    try {
      if (name !== undefined) await space.renameSpace(name, req.userId);
      if (description !== undefined) await space.setDescription(description, req.userId);
    } catch (err) {
      return reply.code(403).send({ error: err instanceof Error ? err.message : 'cannot update space' });
    }
    return spaceDto(req.userId);
  });

  // Managers set the space logo (image upload) or clear it (DELETE).
  app.post('/api/space/logo', async (req, reply) => {
    if (!space.canManage(req.userId)) return reply.code(403).send({ error: 'only owner or admins can change the logo' });
    const part = await req.file({ limits: { fileSize: mb(getPolicies().maxUploadMB) } });
    if (!part) return reply.code(400).send({ error: 'no image' });
    let bytes: Buffer;
    try {
      bytes = await part.toBuffer();
    } catch {
      return reply.code(413).send({ error: `images are capped at ${getPolicies().maxUploadMB} MB here` });
    }
    const mime = effectiveMime(bytes, part.mimetype);
    if (!mime.startsWith('image/')) return reply.code(400).send({ error: 'a logo has to be an image' });
    const { ref, hash } = await space.blobs.put(bytes);
    try {
      await space.setLogo({ key: ref.key, id: ref.id, hash, mime }, req.userId);
    } catch (err) {
      return reply.code(403).send({ error: err instanceof Error ? err.message : 'cannot set logo' });
    }
    return spaceDto(req.userId);
  });

  app.delete('/api/space/logo', async (req, reply) => {
    if (!space.canManage(req.userId)) return reply.code(403).send({ error: 'only owner or admins can change the logo' });
    try {
      await space.setLogo(null, req.userId);
    } catch (err) {
      return reply.code(403).send({ error: err instanceof Error ? err.message : 'cannot clear logo' });
    }
    return spaceDto(req.userId);
  });

  // Serve the logo bytes — small and chrome-level, so pull from a peer if this
  // device doesn't hold them yet. Public like the space name (pre-login chrome).
  app.get('/api/space/logo', async (_req, reply) => {
    const logo = space.state.spaceLogo;
    if (!logo) return reply.code(404).send({ error: 'no logo' });
    const bytes = await space.blobs.get({ key: logo.key, id: logo.id }, { wait: true, timeoutMs: 8_000, expectedHash: logo.hash });
    if (!bytes) return reply.code(409).send({ error: 'logo is not on this device yet' });
    return reply
      .header('content-type', logo.mime)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(bytes);
  });

  // Every space on this device; switching closes the log and opens another.
  app.get('/api/spaces', async () => space.listSpaces());

  app.post('/api/spaces/switch', async (req, reply) => {
    const { dir } = z.object({ dir: z.string().min(1).max(120) }).parse(req.body);
    try {
      await space.switchSpace(dir);
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : 'no such space' });
    }
    return spaceDto(req.userId);
  });

  app.post('/api/space', async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    await space.createSpace(name);
    return spaceDto(req.userId);
  });

  app.post('/api/space/join', async (req, reply) => {
    const { invite } = z.object({ invite: z.string().max(400) }).parse(req.body);
    const parsed = parseInvite(invite);
    if (!parsed) return reply.code(400).send({ error: 'that does not look like a Frith invite' });
    try {
      await space.joinSpace(parsed.name, parsed.inviteHex);
    } catch (err) {
      return reply.code(504).send({ error: err instanceof Error ? err.message : 'pairing failed' });
    }
    return spaceDto(req.userId);
  });

  // Dev helpers (local iteration + tests): create users/channels, load the
  // fictional Acme corpus into the current space. Absent in production.
  if (!PROD()) {
    app.post('/api/dev/user', async (req) => {
      const { handle, name } = z.object({ handle: z.string().min(1), name: z.string().min(1) }).parse(req.body);
      const user = await createUser(handle, name);
      return { id: user.id, handle: user.handle, name: user.name };
    });

    app.post('/api/dev/channel', async (req) => {
      const input = z
        .object({
          name: z.string().min(1),
          type: z.enum(['public', 'private', 'dm']),
          memberHandles: z.array(z.string()).default([]),
        })
        .parse(req.body);
      const id = space.newId();
      await space.append({
        t: 'channel',
        channel: { id, name: input.name, type: input.type, topic: null, archivedAt: null },
      });
      for (const handle of input.memberHandles) {
        const user = await getUserByHandle(handle);
        if (user) await space.append({ t: 'member', channelId: id, userId: user.id });
      }
      return { channelId: id };
    });

    app.post('/api/dev/seed', async (req) => {
      const { corpus } = z
        .object({ corpus: z.enum(['acme', 'skate', 'band']).default('acme') })
        .parse(req.body ?? {});
      return seedCorpus(corpus);
    });

    app.get('/api/dev/debug', async () => space.debug());
  }

  app.post('/api/users/:id/block', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (id === req.userId) return reply.code(400).send({ error: 'you cannot block yourself' });
    return { blockedUserIds: await setBlocked(req.userId, id, true) };
  });

  app.delete('/api/users/:id/block', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return { blockedUserIds: await setBlocked(req.userId, id, false) };
  });

  app.patch('/api/me', async (req) => {
    const trimmed = (max: number) => z.string().trim().max(max).nullable().optional();
    const patch = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        title: trimmed(80),
        team: trimmed(80),
        avatarEmoji: trimmed(16),
        statusEmoji: trimmed(16),
        statusText: trimmed(120),
        statusExpiresInMinutes: z.number().int().min(1).max(10_080).nullable().optional(),
        interests: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
        nowPlaying: trimmed(120),
        theme: z.enum(THEMES).optional(),
      })
      .parse(req.body);
    return updateProfile(req.userId, patch);
  });

  app.get('/api/home', async (req) => getHome(req.userId));

  app.get('/api/connect', async (req) => connectSuggestions(req.userId));

  app.get('/api/users/:id/profile', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const profile = await getProfilePage(req.userId, id);
    if (!profile) return reply.code(404).send({ error: 'no such user' });
    return profile;
  });

  app.get('/api/channels', async (req) => visibleChannels(req.userId));

  app.post('/api/channels', async (req, reply) => {
    const input = z
      .object({
        name: z.string().min(1).max(80),
        type: z.enum(['public', 'private']),
        topic: z.string().trim().max(250).nullable().optional(),
      })
      .parse(req.body);
    const result = await createChannel(req.userId, input);
    if (result === 'invalid-name') return reply.code(400).send({ error: 'channel name is invalid' });
    if (result === 'name-taken') return reply.code(409).send({ error: 'a channel with that name already exists' });
    return { channelId: result.id };
  });

  for (const action of ['archive', 'unarchive'] as const) {
    app.post(`/api/channels/:id/${action}`, async (req, reply) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
      const channel = await getChannel(id);
      if (!channel) return reply.code(404).send({ error: 'no such channel' });
      if (channel.type === 'dm') return reply.code(400).send({ error: 'conversations cannot be archived' });
      if (!(await requireChannelAccess(req, reply, id))) return reply;
      await setChannelArchived(id, action === 'archive');
      return { ok: true };
    });
  }

  // Membership of private channels and groups. Members manage the list;
  // anyone may remove themself (leave). Public channels have no list —
  // everyone in the space is in.
  app.get('/api/channels/:id/members', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await requireChannelAccess(req, reply, id))) return reply;
    return listChannelMembers(id);
  });

  app.post('/api/channels/:id/members', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.body);
    const channel = await getChannel(id);
    if (!channel) return reply.code(404).send({ error: 'no such channel' });
    if (channel.type === 'public') return reply.code(400).send({ error: 'everyone in the space is already here' });
    if (!(await requireChannelAccess(req, reply, id))) return reply; // members only
    const result = await addChannelMember(id, userId);
    if (result === 'no-user') return reply.code(404).send({ error: 'no such person' });
    return listChannelMembers(id);
  });

  app.delete('/api/channels/:id/members/:userId', async (req, reply) => {
    const { id, userId } = z.object({ id: z.string().uuid(), userId: z.string().uuid() }).parse(req.params);
    const channel = await getChannel(id);
    if (!channel) return reply.code(404).send({ error: 'no such channel' });
    if (channel.type === 'public') return reply.code(400).send({ error: 'public channels have no member list' });
    if (!(await requireChannelAccess(req, reply, id))) return reply; // members only (incl. removing yourself)
    await removeChannelMember(id, userId);
    return listChannelMembers(id);
  });

  app.get('/api/channels/:id/messages', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await requireChannelAccess(req, reply, id))) return reply;
    return listChannelMessages(id, req.userId);
  });

  app.post('/api/channels/:id/messages', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ body: z.string().min(1).max(10_000), parentMessageId: z.string().uuid().optional() })
      .parse(req.body);
    if (!(await requireChannelAccess(req, reply, id))) return reply;
    const channel = await getChannel(id);
    if (channel?.archivedAt) {
      return reply.code(409).send({ error: 'this channel is archived' });
    }
    // The op fan-out (below) delivers the websocket event to everyone.
    return createMessage({
      channelId: id,
      authorId: req.userId,
      body: body.body,
      parentMessageId: body.parentMessageId ?? null,
    });
  });

  app.post('/api/channels/:id/read', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await requireChannelAccess(req, reply, id))) return reply;
    await markChannelRead(req.userId, id);
    return { ok: true };
  });

  app.post('/api/dms/:userId', async (req, reply) => {
    const { userId: otherId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    if (otherId === req.userId) return reply.code(400).send({ error: 'that is you' });
    const other = await getUserById(otherId);
    if (!other) return reply.code(404).send({ error: 'no such user' });
    if ((await blockedIds(req.userId)).includes(otherId)) {
      return reply.code(403).send({ error: 'you have blocked this person' });
    }
    if ((await blockedIds(otherId)).includes(req.userId)) {
      return reply.code(403).send({ error: 'this person is not accepting messages from you' });
    }
    const channelId = await getOrCreateGroup(req.userId, [otherId]);
    return { channelId };
  });

  app.post('/api/groups', async (req, reply) => {
    const { userIds } = z
      .object({ userIds: z.array(z.string().uuid()).min(2).max(8) })
      .parse(req.body);
    if (userIds.includes(req.userId)) return reply.code(400).send({ error: 'you are already in it' });
    try {
      const channelId = await getOrCreateGroup(req.userId, userIds);
      return { channelId };
    } catch {
      return reply.code(404).send({ error: 'unknown user in group' });
    }
  });

  app.get('/api/messages/:id/thread', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const root = await getMessage(id);
    if (!root) return reply.code(404).send({ error: 'no such message' });
    if (!(await requireChannelAccess(req, reply, root.channelId))) return reply;
    return getThread(id, req.userId);
  });

  app.post('/api/messages/:id/reactions', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { emoji } = z.object({ emoji: z.string().min(1).max(16) }).parse(req.body);
    const message = await getMessage(id);
    if (!message) return reply.code(404).send({ error: 'no such message' });
    if (!(await requireChannelAccess(req, reply, message.channelId))) return reply;
    const added = await toggleReaction(req.userId, id, emoji);
    return { added };
  });

  app.get('/api/ask', async (req) => {
    const { q } = z.object({ q: z.string().max(500) }).parse(req.query);
    return ask(req.userId, q);
  });

  app.post('/api/task-scope', async (req) => {
    const { requirements } = z.object({ requirements: z.string().trim().min(3).max(2000) }).parse(req.body);
    return taskScope(req.userId, requirements);
  });

  // Attach a file (image/video/audio/anything) as a new message in a channel.
  app.post('/api/channels/:id/attachments', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await requireChannelAccess(req, reply, id))) return reply;
    const channel = await getChannel(id);
    if (channel?.archivedAt) return reply.code(409).send({ error: 'this channel is archived' });

    const part = await req.file({ limits: { fileSize: mb(getPolicies().maxUploadMB) } });
    if (!part) return reply.code(400).send({ error: 'no file' });
    const fields = part.fields as Record<string, { value?: string } | undefined>;
    const caption = (fields.caption?.value ?? '').slice(0, 10_000);
    const parentMessageId = fields.parentMessageId?.value || null;

    let bytes: Buffer;
    try {
      bytes = await part.toBuffer();
    } catch {
      return reply.code(413).send({ error: `files are capped at ${getPolicies().maxUploadMB} MB here` });
    }

    // Attachment op (bytes already in our blob core) lands before the
    // message op so the fan-out sees a complete message.
    const messageId = space.newId();
    // Trust the bytes over the declared type: media that isn't what it
    // claims to be gets stored as a plain download.
    const mime = effectiveMime(bytes, part.mimetype);
    // Mint the channel's content key first if this is its very first write,
    // so the attachment seals under it rather than falling back to plaintext.
    await space.ensureDomainKey(space.contentDomain(channel!.type, id), req.userId);
    await addAttachment(messageId, id, part.filename || 'file', mime, bytes);
    return createMessage({ id: messageId, channelId: id, authorId: req.userId, body: caption, parentMessageId });
  });

  // Files inherit the ACL of the message they're attached to. Bytes come
  // from this device when we have them; `?wait=1` pulls them from a peer
  // first (the explicit "download this" click).
  app.get('/api/files/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { wait } = z.object({ wait: z.string().optional() }).parse(req.query);
    const attachment = await getAttachment(id);
    if (!attachment) return reply.code(404).send({ error: 'no such file' });
    if (!(await requireChannelAccess(req, reply, attachment.channelId))) return reply;

    const sendBytes = (body: Buffer | fs.ReadStream) =>
      reply
        .header('content-type', attachment.mime)
        .header('x-content-type-options', 'nosniff')
        .header(
          'content-disposition',
          // Media renders inline; everything else downloads — a spoofed or
          // executable file never executes in the window that shows chat.
          `${/^(image|video|audio)\//.test(attachment.mime) && !isDangerousName(attachment.name) ? 'inline' : 'attachment'}; filename="${attachment.name.replace(/"/g, '')}"`,
        )
        .send(body);

    if (!attachment.blob) {
      // Pre-blob attachment: bytes exist only on the uploader's disk.
      const legacy = path.join(filesDir, id);
      if (!fs.existsSync(legacy)) return reply.code(404).send({ error: 'file is not on this device' });
      return sendBytes(fs.createReadStream(legacy));
    }

    const wasCached = space.blobs.isCachedSync(attachment.blob);
    const bytes = await space.blobs.get(attachment.blob, {
      wait: wait === '1',
      expectedHash: attachment.hash,
    });
    if (!bytes) {
      return reply.code(409).send({
        error: 'file is not on this device yet',
        needsFetch: true,
        size: attachment.size,
      });
    }
    if (!wasCached) {
      publish(
        { type: 'file.cached', channelId: attachment.channelId, messageId: attachment.messageId, attachmentId: id },
        await channelAudience(attachment.channelId),
      );
      void space.blobs.enforceBudget(mb(getPolicies().storageBudgetMB));
    }
    // Blob bytes are sealed under the channel's content key; a device that was
    // removed before this file was shared has no key to open it.
    const clear = space.decryptBytes(bytes);
    if (!clear) return reply.code(403).send({ error: 'you no longer have access to this file' });
    return sendBytes(clear);
  });

  // Everything shared in channels the viewer can read, newest first.
  app.get('/api/files', async (req) => listFiles(req.userId));

  // Shared docs: the space's living pages, synced as ops like everything else.
  app.get('/api/docs', async () => listDocs());

  app.post('/api/docs', async (req) => {
    const { title } = z.object({ title: z.string().trim().min(1).max(120) }).parse(req.body);
    return createDoc(req.userId, title);
  });

  app.get('/api/docs/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const doc = await getDoc(id);
    if (!doc) return reply.code(404).send({ error: 'no such doc' });
    return doc;
  });

  app.put('/api/docs/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const patch = z
      .object({
        title: z.string().trim().min(1).max(120).optional(),
        body: z.string().max(200_000).optional(),
      })
      .parse(req.body);
    const doc = await updateDoc(req.userId, id, patch);
    if (!doc) return reply.code(404).send({ error: 'no such doc' });
    return doc;
  });

  app.delete('/api/docs/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await removeDoc(req.userId, id);
    if (result === 'no-doc') return reply.code(404).send({ error: 'no such doc' });
    if (result === 'forbidden') return reply.code(403).send({ error: 'only the creator or a manager can remove a doc' });
    return { ok: true };
  });

  // Device-local storage policies: what this machine stores and downloads.
  app.get('/api/storage', async () => ({ policies: getPolicies(), usage: space.blobs.usage() }));

  app.put('/api/storage/policies', async (req) => {
    const patch = z
      .object({
        maxUploadMB: z.number().int().min(1).max(4096).optional(),
        autoFetchMB: z.number().int().min(0).max(4096).optional(),
        autoFetchRecentDays: z.number().int().min(0).max(3650).optional(),
        storageBudgetMB: z.number().int().min(0).max(1_048_576).optional(),
      })
      .parse(req.body);
    const policies = setPolicies(patch);
    await space.blobs.enforceBudget(mb(policies.storageBudgetMB));
    return { policies, usage: space.blobs.usage() };
  });

  app.delete('/api/storage/cache', async () => {
    await space.blobs.clearCache();
    return { policies: getPolicies(), usage: space.blobs.usage() };
  });

  app.get('/api/calls', async () => activeCalls());

  app.post('/api/channels/:id/schedule', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { body, inMinutes } = z
      .object({ body: z.string().min(1).max(10_000), inMinutes: z.number().int().min(1).max(10_080) })
      .parse(req.body);
    if (!(await requireChannelAccess(req, reply, id))) return reply;
    const channel = await getChannel(id);
    if (channel?.archivedAt) return reply.code(409).send({ error: 'this channel is archived' });
    return scheduleMessage({
      authorId: req.userId,
      channelId: id,
      body,
      sendAt: new Date(Date.now() + inMinutes * 60_000),
    });
  });

  app.get('/api/scheduled', async (req) => listScheduled(req.userId));

  app.delete('/api/scheduled/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await cancelScheduled(req.userId, id))) return reply.code(404).send({ error: 'not found' });
    return { ok: true };
  });

  app.post('/api/channels/:id/pin', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { pinned } = z.object({ pinned: z.boolean() }).parse(req.body);
    if (!(await requireChannelAccess(req, reply, id))) return reply;
    await setPinned(req.userId, id, pinned);
    return { ok: true };
  });

  app.put('/api/pins', async (req) => {
    const { channelIds } = z.object({ channelIds: z.array(z.string().uuid()).max(50) }).parse(req.body);
    await reorderPins(req.userId, channelIds);
    return { ok: true };
  });

  app.post('/api/channels/:id/call/join', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await requireChannelAccess(req, reply, id))) return reply;
    return { participants: await joinCall(id, req.userId) };
  });

  app.post('/api/channels/:id/call/leave', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await requireChannelAccess(req, reply, id))) return reply;
    await leaveCall(id, req.userId);
    return { ok: true };
  });

  // Flag yourself as recording the campfire. Consent posture: only someone IN
  // the call can record it, and everyone present (and joining) sees who is.
  app.post('/api/channels/:id/call/record', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { on } = z.object({ on: z.boolean() }).parse(req.body);
    if (!(await requireChannelAccess(req, reply, id))) return reply;
    if ((await setRecording(id, req.userId, on)) === 'not-in-call') {
      return reply.code(409).send({ error: 'join the call before recording it' });
    }
    return { ok: true };
  });

  setOnUserOffline((userId) => void leaveAllCalls(userId));

  app.get('/api/ws', { websocket: true }, (socket, req) => {
    register(socket, req.userId);
    // Clients send WebRTC signaling through here; the server relays blindly —
    // media itself never touches the server.
    socket.on('message', (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString()) as {
          type?: string;
          to?: string;
          payload?: unknown;
          channelId?: string;
          seg?: { id?: unknown; color?: unknown; points?: unknown };
        };
        if (event.type === 'rtc.signal' && typeof event.to === 'string' && event.payload) {
          sendToUser(event.to, {
            type: 'rtc.signal',
            from: req.userId,
            payload: event.payload as never,
          });
        }
        // Screen-share ink: relayed to the channel's audience and never stored —
        // annotations are gestures, not records. Size-capped like any relay.
        if (event.type === 'call.draw' && typeof event.channelId === 'string' && event.seg) {
          const { id, color, points } = event.seg;
          if (typeof id !== 'string' || id.length > 40) return;
          if (typeof color !== 'string' || color.length > 32) return;
          if (!Array.isArray(points) || points.length === 0 || points.length > 128) return;
          if (!points.every((p) => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number')) return;
          const channelId = event.channelId;
          void channelAudience(channelId).then((audience) =>
            publish({ type: 'call.draw', channelId, from: req.userId, seg: { id, color, points: points as [number, number][] } }, audience),
          );
        }
      } catch {
        // ignore malformed frames
      }
    });
  });

  return app;
}
