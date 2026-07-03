// P2P backend: joins a Hyperswarm topic, persists the room log locally,
// and syncs signed messages with peers.
//
// Security properties (see DESIGN.md §16):
// - transport: Hyperswarm sockets are end-to-end encrypted (Noise)
// - authorship: every message is ed25519-signed by its author's device key;
//   peers verify before storing or displaying, and drop forgeries
// - storage: history lives only on participants' machines (append-only
//   JSONL per room under the data dir)
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const Hyperswarm = require('hyperswarm');
const hypercoreCrypto = require('hypercore-crypto');
const b4a = require('b4a');
const { loadIdentity } = require('../lib/identity');
const { RoomStore } = require('../lib/store');

const dataDir = process.env.LORE_DATA_DIR || path.join(os.homedir(), '.lore-p2p');
const room = process.env.LORE_ROOM || `dev-${os.userInfo().username}`;
const topic = crypto.createHash('sha256').update(`lore-p2p-chat:${room}`).digest();

const identity = loadIdentity(dataDir);
const me = b4a.toString(identity.publicKey, 'hex');
const store = new RoomStore(dataDir, room);

function tell(event) {
  if (process.send) process.send(event);
  else console.log('[swarm]', JSON.stringify(event));
}

// What the signature covers. Anything not in here is forgeable — so
// everything that matters is in here.
function canonical(msg) {
  return `${msg.author}|${msg.seq}|${msg.ts}|${msg.name}|${msg.text}`;
}

function verify(msg) {
  try {
    return hypercoreCrypto.verify(
      b4a.from(canonical(msg)),
      b4a.from(msg.sig, 'hex'),
      b4a.from(msg.author, 'hex'),
    );
  } catch {
    return false;
  }
}

const swarm = new Hyperswarm();
const connections = new Set();

// Sockets are streams: frames are newline-delimited JSON with a per-socket
// buffer for partial reads.
function sendFrame(socket, frame) {
  socket.write(b4a.from(`${JSON.stringify(frame)}\n`));
}

function broadcast(frame, except) {
  for (const socket of connections) {
    if (socket !== except) sendFrame(socket, frame);
  }
}

function acceptMessage(msg, from) {
  if (!verify(msg)) {
    tell({ type: 'rejected', author: msg.author?.slice(0, 8) });
    return;
  }
  if (store.append(msg)) {
    tell({ type: 'message', message: msg });
    // Gossip to everyone else so late joiners' backfills converge faster.
    broadcast({ type: 'message', message: msg }, from);
  }
}

swarm.on('connection', (socket) => {
  connections.add(socket);
  tell({ type: 'peers', count: connections.size });

  let buffer = '';
  socket.on('data', (data) => {
    buffer += b4a.toString(data);
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let frame;
      try {
        frame = JSON.parse(line);
      } catch {
        continue;
      }
      if (frame.type === 'hello') {
        sendFrame(socket, { type: 'backfill', messages: store.missingFor(frame.heads ?? {}) });
      } else if (frame.type === 'backfill') {
        for (const msg of frame.messages ?? []) acceptMessage(msg, socket);
      } else if (frame.type === 'message' && frame.message) {
        acceptMessage(frame.message, socket);
      }
    }
  });

  const drop = () => {
    connections.delete(socket);
    tell({ type: 'peers', count: connections.size });
  };
  socket.on('close', drop);
  socket.on('error', drop);

  sendFrame(socket, { type: 'hello', heads: store.heads() });
});

// From the UI: sign, persist locally, then fan out.
process.on('message', ({ text, name }) => {
  const msg = {
    author: me,
    seq: store.nextSeq(me),
    ts: Date.now(),
    name,
    text,
  };
  msg.sig = b4a.toString(hypercoreCrypto.sign(b4a.from(canonical(msg)), identity.secretKey), 'hex');
  store.append(msg);
  tell({ type: 'message', message: msg });
  broadcast({ type: 'message', message: msg });
});

swarm.join(topic, { server: true, client: true }).flushed().then(() => {
  tell({ type: 'ready', room, me, history: store.messages.length });
  tell({ type: 'history', messages: store.messages });
});
