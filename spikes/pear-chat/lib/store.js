// Local-first room storage: an append-only JSONL log per room, on this
// machine only. Peers exchange "heads" (highest sequence number seen per
// author) on connect and backfill each other the difference — history
// lives with the participants, not on a server.
//
// This is the hand-rolled warm-up for Hypercore/Autobase (DESIGN.md §14):
// same shape (per-author append-only logs + a merged view), none of the
// magic yet.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class RoomStore {
  constructor(dataDir, room) {
    const slug = crypto.createHash('sha256').update(room).digest('hex').slice(0, 16);
    this.file = path.join(dataDir, 'rooms', `${slug}.jsonl`);
    this.messages = [];
    this.maxSeq = new Map(); // authorHex → highest seq seen
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (fs.existsSync(this.file)) {
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
        if (!line) continue;
        try {
          this.track(JSON.parse(line));
        } catch {
          // a torn last line from a crash is not fatal
        }
      }
    }
  }

  track(msg) {
    this.messages.push(msg);
    if ((this.maxSeq.get(msg.author) ?? 0) < msg.seq) this.maxSeq.set(msg.author, msg.seq);
  }

  has(msg) {
    return this.messages.some((m) => m.author === msg.author && m.seq === msg.seq);
  }

  /** Highest seq per author — what we already have. */
  heads() {
    return Object.fromEntries(this.maxSeq);
  }

  /** Messages the peer (with those heads) is missing. */
  missingFor(theirHeads, limit = 500) {
    return this.messages.filter((m) => m.seq > (theirHeads[m.author] ?? 0)).slice(-limit);
  }

  /** Append if new; returns whether it was new. */
  append(msg) {
    if (this.has(msg)) return false;
    this.track(msg);
    fs.appendFileSync(this.file, `${JSON.stringify(msg)}\n`);
    return true;
  }

  nextSeq(authorHex) {
    return (this.maxSeq.get(authorHex) ?? 0) + 1;
  }
}

module.exports = { RoomStore };
