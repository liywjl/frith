# Security

## Reporting a vulnerability

Use GitHub's private reporting: **Security tab → Report a vulnerability**,
with a description and reproduction steps. Please don't open a public issue
for anything exploitable — give us a chance to fix it first. Anything
non-sensitive is welcome as a regular [issue](https://github.com/liywjl/frith/issues).

## Threat model & maturity

Frith is peer-to-peer end to end: every space is a multi-writer
[Autobase](https://docs.pears.com) log replicated over Hyperswarm, so the
security boundary is the log itself, not a server. The standing threat-model
work lives in [HARDENING.md](HARDENING.md) — each item states its status
honestly. Highlights of what is and isn't done:

**Done:** content ops are signature-authorized at the reducer, so a revoked
or evicted writer's appends are inert (§10); append rate and what a log can
make a peer fetch/hold are bounded (§1, §11); directory entries are
curator-signed (§7); blob purge on eviction (§4); request-boundary
regression tests (§8); edge hardening on framing, file serving, and binding
routes (§12).

**Designed, not yet implemented:**

- **Writer removal via log rotation (§2).** An evicted node's appends are
  inert but still replicate into honest members' logs, consuming disk and
  replay time, until log rotation lands.
- **Selective replication by decryptable domain (§3).** Peers currently
  replicate ciphertext for channels they can't decrypt. Envelope metadata
  (author, channel, timing, size) for private channels still reaches every
  space member.
- **Role-gated writer admission.** Any current member's node can append an
  `add-writer` op, not just managers, and admissions made before a member's
  eviction stay functional. Until log rotation (§2) lands, eviction is
  best-effort against a writer an evicted member admitted earlier.
- **Offline-key plaintext fallback.** A message sent before this device has
  received the domain's content key is stored unencrypted rather than
  dropped. The window is normally seconds wide; queueing instead is planned.

**Partial:** dependency pinning + review on the P2P stack (§9).

**Known limitation:** local login is dev-auth — you pick a user, no
passwords. Fine for a single-user machine (the OS user account is the
boundary, as with any desktop app's local data), but there is no in-app
authentication yet.

If any of this is a blocker for your use case, treat Frith as enthusiast
software — that's what it is today.
