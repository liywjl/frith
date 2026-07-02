import { buildApp } from './app.js';

const app = await buildApp();
await app.listen({ port: Number(process.env.PORT ?? 3001), host: '127.0.0.1' });
