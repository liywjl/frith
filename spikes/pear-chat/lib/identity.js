// Device identity: an ed25519 keypair generated on first run and stored
// only on this machine. The public key IS your identity — there is no
// account server to create one on. Messages are signed with the secret key
// so peers can verify authorship (see swarm.js).
const fs = require('fs');
const path = require('path');
const crypto = require('hypercore-crypto');
const b4a = require('b4a');

function loadIdentity(dataDir) {
  const file = path.join(dataDir, 'identity.json');
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      publicKey: b4a.from(saved.publicKey, 'hex'),
      secretKey: b4a.from(saved.secretKey, 'hex'),
    };
  }
  const pair = crypto.keyPair();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({
      publicKey: b4a.toString(pair.publicKey, 'hex'),
      secretKey: b4a.toString(pair.secretKey, 'hex'),
    }),
    { mode: 0o600 }, // secret key: owner-readable only
  );
  return pair;
}

module.exports = { loadIdentity };
