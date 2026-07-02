import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import {
  canReadChannel,
  channelAudience,
  createMessage,
  getMessage,
  getThread,
  getUserByHandle,
  getUserById,
  listChannelMessages,
  listUsers,
  visibleChannels,
} from './store.js';
import { publish, register } from './realtime.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

const AUTH_COOKIE = 'uid';

export async function buildApp() {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  await app.register(cookie);
  await app.register(websocket);

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

  // Everything below requires auth.
  app.addHook('preHandler', async (req, reply) => {
    if (req.url.startsWith('/api/dev/') || req.url === '/api/users') return;
    const uid = req.cookies[AUTH_COOKIE];
    const user = uid ? await getUserById(uid) : null;
    if (!user) return reply.code(401).send({ error: 'not logged in' });
    req.userId = user.id;
  });

  app.get('/api/me', async (req) => {
    const user = await getUserById(req.userId);
    return { id: user!.id, handle: user!.handle, name: user!.name };
  });

  app.get('/api/channels', async (req) => visibleChannels(req.userId));

  app.get('/api/channels/:id/messages', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await canReadChannel(req.userId, id))) {
      return reply.code(403).send({ error: 'no access to this channel' });
    }
    return listChannelMessages(id);
  });

  app.post('/api/channels/:id/messages', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z
      .object({ body: z.string().min(1).max(10_000), parentMessageId: z.string().uuid().optional() })
      .parse(req.body);
    if (!(await canReadChannel(req.userId, id))) {
      return reply.code(403).send({ error: 'no access to this channel' });
    }
    const message = await createMessage({
      channelId: id,
      authorId: req.userId,
      body: body.body,
      parentMessageId: body.parentMessageId ?? null,
    });
    publish({ type: 'message.created', message }, await channelAudience(id));
    return message;
  });

  app.get('/api/messages/:id/thread', async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const root = await getMessage(id);
    if (!root) return reply.code(404).send({ error: 'no such message' });
    if (!(await canReadChannel(req.userId, root.channelId))) {
      return reply.code(403).send({ error: 'no access to this channel' });
    }
    return getThread(id);
  });

  app.get('/api/ws', { websocket: true }, (socket, req) => {
    register(socket, req.userId);
  });

  return app;
}
