// P2P backend: joins a Hyperswarm topic and relays messages between the
// Electron main process (via child-process IPC) and connected peers (via
// end-to-end-encrypted Hyperswarm sockets).
const crypto = require('crypto');
const os = require('os');
const Hyperswarm = require('hyperswarm');
const b4a = require('b4a');

// Peers on the same "room" find each other; default isolates by machine user
// (same trick as the Pears tutorial) so two local instances pair up for demos.
const room = process.env.LORE_ROOM || `dev-${os.userInfo().username}`;
const topic = crypto.createHash('sha256').update(`lore-p2p-chat:${room}`).digest();

const swarm = new Hyperswarm();
const connections = new Set();

function tell(event) {
  if (process.send) process.send(event);
  else console.log('[swarm]', JSON.stringify(event));
}

swarm.on('connection', (socket) => {
  connections.add(socket);
  tell({ type: 'peers', count: connections.size });
  socket.on('data', (data) => {
    try {
      tell({ type: 'message', ...JSON.parse(b4a.toString(data)) });
    } catch {
      // ignore malformed frames from peers
    }
  });
  const drop = () => {
    connections.delete(socket);
    tell({ type: 'peers', count: connections.size });
  };
  socket.on('close', drop);
  socket.on('error', drop);
});

process.on('message', (msg) => {
  const frame = b4a.from(JSON.stringify(msg));
  for (const socket of connections) socket.write(frame);
});

swarm.join(topic, { server: true, client: true }).flushed().then(() => {
  tell({ type: 'ready', room });
});
