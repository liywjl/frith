# Security

## Reporting a vulnerability

Email **contact@thabotech.com** with a description and reproduction steps.
Please don't open a public issue for anything exploitable — give us a chance
to fix it first. You'll get an acknowledgement within a few days.

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
  replicate ciphertext for channels they can't decrypt.

**Partial:** dependency pinning + review on the P2P stack (§9).

**Known limitation:** local login is dev-auth — you pick a user, no
passwords. Fine for a single-user machine (the OS user account is the
boundary, as with any desktop app's local data), but there is no in-app
authentication yet.

If any of this is a blocker for your use case, treat Frith as enthusiast
software — that's what it is today.
