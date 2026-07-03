// Headless proof that the P2P core works: two Hyperswarm peers on a random
// topic find each other over the DHT and exchange a message, no server involved.
import crypto from 'node:crypto';
import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';

const topic = crypto.randomBytes(32);
const a = new Hyperswarm();
const b = new Hyperswarm();

const timeout = setTimeout(() => {
  console.error('SMOKE FAIL: peers did not exchange a message within 60s');
  process.exit(1);
}, 60_000);

const received = new Promise((resolve) => {
  b.on('connection', (socket) => {
    socket.on('error', () => {}); // teardown races are fine, we only care about the exchange
    socket.on('data', (data) => resolve(b4a.toString(data)));
  });
});

a.on('connection', (socket) => {
  socket.on('error', () => {});
  socket.write(b4a.from('hello from lore, no server involved'));
});

await a.join(topic, { server: true, client: true }).flushed();
await b.join(topic, { server: true, client: true }).flushed();

const message = await received;
console.log(`SMOKE OK: peer received "${message}"`);
clearTimeout(timeout);
await Promise.allSettled([a.destroy(), b.destroy()]);
process.exit(0);
