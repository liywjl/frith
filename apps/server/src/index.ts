import { startServer } from './start.js';

await startServer(Number(process.env.PORT ?? 3001));
