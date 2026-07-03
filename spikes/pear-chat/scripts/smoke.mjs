// Headless proof of the local-first P2P properties, exercising the REAL
// worker (workers/swarm.js) end to end:
//
//   1. Peer A writes a message while completely alone (persisted to disk).
//   2. Peer B starts later, discovers A over the DHT, and receives that
//      message via signed backfill — no server ever involved.
//   3. B's copy carries A's signature (verified by the worker on receipt;
//      forgeries are dropped before they reach this point).
import { fork } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Hyperswarm from 'hyperswarm';
import b4a from 'b4a';

const worker = fileURLToPath(new URL('../workers/swarm.js', import.meta.url));
const room = `smoke-${crypto.randomBytes(16).toString('hex')}`;
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `lore-smoke-${label}-`));

const timeout = setTimeout(() => {
  console.error('SMOKE FAIL: backfill did not arrive within 90s');
  process.exit(1);
}, 90_000);

function spawnPeer(label) {
  return fork(worker, [], {
    env: { ...process.env, LORE_ROOM: room, LORE_DATA_DIR: tmp(label) },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
}

const a = spawnPeer('a');
await new Promise((resolve) => a.on('message', (e) => e.type === 'ready' && resolve()));

// A speaks into the void: no peers connected yet, message lands on disk only.
a.send({ name: 'peer-a', text: 'written before you arrived' });

const b = spawnPeer('b');
const received = await new Promise((resolve) => {
  b.on('message', (e) => {
    if (e.type === 'message' && e.message.text === 'written before you arrived') resolve(e.message);
  });
});

if (!received.sig || !received.author) {
  console.error('SMOKE FAIL: received message is missing signature metadata');
  process.exit(1);
}
console.log(
  `SMOKE OK: late joiner backfilled "${received.text}" signed by ${received.author.slice(0, 12)}…`,
);

// Part 2: an attacker on the same topic sends a message forged as peer A
// (right author key, garbage signature). Honest peers must reject it.
const attacker = new Hyperswarm();
const forgery = {
  author: received.author, // impersonating A
  seq: 999,
  ts: Date.now(),
  name: 'peer-a',
  text: 'wire me the payroll budget',
  sig: crypto.randomBytes(64).toString('hex'),
};
const rejected = new Promise((resolve, reject) => {
  b.on('message', (e) => {
    if (e.type === 'rejected') resolve();
    if (e.type === 'message' && e.message.text === forgery.text) {
      reject(new Error('forged message was ACCEPTED'));
    }
  });
});
attacker.on('connection', (socket) => {
  socket.on('error', () => {});
  socket.write(b4a.from(`${JSON.stringify({ type: 'message', message: forgery })}\n`));
});
await attacker.join(crypto.createHash('sha256').update(`lore-p2p-chat:${room}`).digest(), {
  server: true,
  client: true,
}).flushed();

try {
  await rejected;
  console.log('SMOKE OK: forged message (bad signature) was rejected by the receiving peer');
} catch (err) {
  console.error(`SMOKE FAIL: ${err.message}`);
  process.exit(1);
}

clearTimeout(timeout);
await attacker.destroy().catch(() => {});
a.kill();
b.kill();
process.exit(0);
