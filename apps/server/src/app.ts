import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import { THEMES } from '@app/shared';
import {
  addAttachment,
  blockedIds,
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
} from './store.js';
import { ask, taskScope } from './ask.js';
import { publish, register, sendToUser, setOnUserOffline } from './realtime.js';
import { activeCalls, joinCall, leaveAllCalls, leaveCall } from './calls.js';
import { space } from './data/space.js';
import { seedCorpus } from './seed.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

const AUTH_COOKIE = 'uid';

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

export async function buildApp() {
  if (!space.isOpen) await space.open(process.env.LORE_DATA ?? '.lore-data');

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
        } else if (op.t === 'channel' || op.t === 'archive') {
          publish({ type: 'channels.changed' }, 'all');
        }
      })();
    });
    space.onPeers((count) => publish({ type: 'p2p.peers', count }, 'all'));
  }

  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cookie);
  await app.register(websocket);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  const filesDir = process.env.LORE_FILES ?? path.join('.data', 'uploads');
  fs.mkdirSync(filesDir, { recursive: true });

  // Dev auth: pick a seeded user by handle, get a cookie. Real auth comes
  // when the product needs it; local iteration speed wins for now.
  app.post('/api/dev/login', async (req, reply) => {
    const body = z.object({ handle: z.string() }).parse(req.body);
    const user = await getUserByHandle(body.handle);
    if (!user) return reply.code(404).send({ error: 'no such user' });
    reply.setCookie(AUTH_COOKIE, user.id, { path: '/' });
    return { id: user.id, handle: user.handle, name: user.name };
  });

  app.get('/api/users', async () => listUsers());

  // Everything below requires auth. Space config is instance-level, not
  // user-level: a fresh instance must be able to join a space before any
  // user exists to log in as.
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/dev/') || req.url === '/api/users' || req.url.startsWith('/api/space')) return;
    const uid = req.cookies[AUTH_COOKIE];
    const user = uid ? await getUserById(uid) : null;
    if (!user) return reply.code(401).send({ error: 'not logged in' });
    req.userId = user.id;
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

  const spaceDto = () => ({
    name: space.name,
    invite: space.invite(),
    connectedPeers: space.connectedPeers(),
  });

  app.get('/api/space', async () => spaceDto());

  app.post('/api/space', async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    await space.createSpace(name);
    return spaceDto();
  });

  app.post('/api/space/join', async (req, reply) => {
    const { invite } = z.object({ invite: z.string().max(400) }).parse(req.body);
    const parsed = parseInvite(invite);
    if (!parsed) return reply.code(400).send({ error: 'that does not look like a Lore invite' });
    try {
      await space.joinSpace(parsed.name, parsed.inviteHex);
    } catch (err) {
      return reply.code(504).send({ error: err instanceof Error ? err.message : 'pairing failed' });
    }
    return spaceDto();
  });

  // Dev helpers (local iteration + tests): create users/channels, load the
  // fictional Acme corpus into the current space.
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

  app.post('/api/dev/seed', async () => seedCorpus());

  app.get('/api/dev/debug', async () => space.debug());

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

    const part = await req.file();
    if (!part) return reply.code(400).send({ error: 'no file' });
    const fields = part.fields as Record<string, { value?: string } | undefined>;
    const caption = (fields.caption?.value ?? '').slice(0, 10_000);
    const parentMessageId = fields.parentMessageId?.value || null;

    // Attachment op lands before the message op so the fan-out sees a
    // complete message; the file is on disk before either.
    const messageId = space.newId();
    const attachment = await addAttachment(messageId, part.filename || 'file', part.mimetype, 0);
    await fs.promises.writeFile(path.join(filesDir, attachment.id), await part.toBuffer());
    return createMessage({ id: messageId, channelId: id, authorId: req.userId, body: caption, parentMessageId });
  });

  // Files inherit the ACL of the message they're attached to.
  app.get('/api/files/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const attachment = await getAttachment(id);
    if (!attachment) return reply.code(404).send({ error: 'no such file' });
    if (!(await requireChannelAccess(req, reply, attachment.channelId))) return reply;
    return reply
      .header('content-type', attachment.mime)
      .header('content-disposition', `inline; filename="${attachment.name.replace(/"/g, '')}"`)
      .send(fs.createReadStream(path.join(filesDir, id)));
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

  setOnUserOffline((userId) => void leaveAllCalls(userId));

  app.get('/api/ws', { websocket: true }, (socket, req) => {
    register(socket, req.userId);
    // Clients send WebRTC signaling through here; the server relays blindly —
    // media itself never touches the server.
    socket.on('message', (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString()) as { type?: string; to?: string; payload?: unknown };
        if (event.type === 'rtc.signal' && typeof event.to === 'string' && event.payload) {
          sendToUser(event.to, {
            type: 'rtc.signal',
            from: req.userId,
            payload: event.payload as never,
          });
        }
      } catch {
        // ignore malformed frames
      }
    });
  });

  return app;
}
