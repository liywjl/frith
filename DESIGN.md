# AI-Native Team Communication Platform — Design Document

Status: draft v0.4 (2026-07-05) — v0.4 adds §17 (identity & key custody, shipped) and the chat+files refocus; v0.3 added §14 (P2P pivot) and §15 (social layer)
Working name: Frith

## 1. The core idea

Slack treats messages as the product and search as a feature. We invert that:
**the organizational knowledge that accumulates in conversations is the product;
chat, huddles, and integrations are how that knowledge gets created.**

The defining user moment: a new engineer joins and is handed a task. Today they
spend days figuring out *who* knows about this, *where* it was last discussed,
*which* docs and code are relevant. In our product they ask one question and get:

- **People** — who has talked about this, who reviewed related code, who is the
  de-facto gatekeeper (with evidence, not just a name).
- **Threads** — the prior conversations that matter, summarized.
- **Documents** — linked docs, RFCs, runbooks that were referenced in context.
- **Code** — repos, files, and PRs that came up alongside those discussions.
- **A synthesized brief** — "here's the state of this topic, the open questions,
  and who decided what" — with citations back to every source.

Everything else in the design serves that loop.

## 2. Design principles

1. **Two planes, one event log.** A *messaging plane* (realtime chat, calls)
   and a *knowledge plane* (ingestion, embedding, graph building, retrieval).
   The knowledge plane is an async consumer of the messaging plane's event
   stream — it can lag, be rebuilt, or be swapped without touching chat.
2. **Permissions are sacred.** The AI never surfaces content the asking user
   couldn't read themselves. Retrieval is ACL-filtered at query time, not at
   index time. This is the single most important correctness property.
3. **Sovereignty is an architecture, not a checkbox.** Every AI capability
   (generation, embeddings, transcription) sits behind a provider-agnostic
   gateway. The **reference deployment runs entirely on local/self-hosted
   models** — remote providers are the optional upgrade, not the default.
4. **Everything is a citable source.** Messages, transcript segments, doc
   chunks, code references all share one "knowledge item" abstraction so the AI
   can cite any of them uniformly.
5. **Consent and transparency built in.** Per-channel indexing controls,
   visible recording state, audit logs of AI access, and honest handling of
   private conversations (§8). In the EU market this is a selling point.
6. **One-command local dev.** The entire system — app, database, workers, and
   local AI models — comes up with a single command on a laptop. If a feature
   can't be demonstrated locally against seed data, it isn't done.
7. **Lean by policy, not by discipline alone.** AI-assisted development tends
   to accrete code. We counter it structurally: strict typing, linters, dead-code
   analysis (Fallow), and tests are CI gates, and "delete unused things" is a
   recurring chore, not a someday task. Schema and abstractions start minimal
   and grow only when a real feature forces them.

## 3. Product surface (v1 scope)

### Messaging (table stakes — must be genuinely good)
- Workspaces, public/private channels, DMs, group DMs
- Threads, reactions, mentions, file sharing, link unfurling
- Realtime sync (WebSocket), offline-tolerant client, full-text search

### Huddles / calls
- Ad-hoc audio/video in any channel or DM (WebRTC via LiveKit — open source,
  self-hostable, first-class Node/React SDKs)
- Recording on by default *with visible indicator and per-workspace policy*
- Post-call pipeline: local transcription (§7) → diarized transcript →
  summary → action items → indexed into the knowledge plane

### The Ask surface (the differentiator)
- A first-class "Ask" pane (not a bot in a channel): natural-language question →
  structured answer: people / threads / docs / code / brief, every claim cited
- Task-oriented mode: "I need to do X" → onboarding brief for that task
- Proactive surfacing (later): when you're typing in a channel, related prior
  threads appear ("this was discussed 3 months ago →")

### Connectors (post-v1)
- GitHub/GitLab (repos, PRs, review activity — powers "who knows this code")
- Docs sources (Google Drive / Notion / Confluence)
- No Slack integration/import. Out of scope by decision — the cold-start
  problem for development is solved by the seed corpus (§10) instead.

## 4. Architecture

```
┌─────────────┐   WebSocket/HTTP   ┌──────────────────┐
│ React client │◄──────────────────►│  API + Realtime  │  Node/TS (Fastify + WS)
└─────────────┘                    │     gateway      │
       ▲                           └────────┬─────────┘
       │ WebRTC                             │ writes
┌──────┴──────┐                    ┌────────▼─────────┐
│   LiveKit   │── egress/audio ──► │    Postgres      │  source of truth
│ (huddles)   │                    │  (+ pgvector)    │
└─────────────┘                    └────────┬─────────┘
                                            │ outbox → event stream
                                   ┌────────▼─────────┐
                                   │  Ingestion       │  queue workers (BullMQ)
                                   │  pipeline        │
                                   │  chunk→embed→    │
                                   │  extract→graph   │
                                   └────────┬─────────┘
                                            │
                          ┌─────────────────┼──────────────────┐
                 ┌────────▼───────┐ ┌───────▼────────┐ ┌───────▼────────┐
                 │ Vector + FTS   │ │ Expertise /    │ │  AI Gateway    │
                 │ hybrid index   │ │ entity graph   │ │ (§6)           │
                 └────────────────┘ └────────────────┘ └───────┬────────┘
                                                       ┌───────▼────────┐
                                                       │ Local models:  │
                                                       │ Ollama (Qwen)  │
                                                       │ Parakeet ASR   │
                                                       └────────────────┘
```

Stack choices:
- **Client:** React + TypeScript (Vite). Browser-first for iteration speed;
  desktop shell is a later phase (§9).
- **Backend:** Node/TypeScript. Fastify for HTTP, native WS for realtime.
  Monorepo (pnpm + Turborepo), shared types end-to-end.
- **Database:** Postgres as the single source of truth. pgvector for embeddings,
  Postgres FTS for keyword search → **hybrid retrieval** (rank fusion) without
  a separate search cluster. Revisit only when scale demands it.
- **Events:** transactional outbox table in Postgres → BullMQ workers (Redis).
  The knowledge plane replays from the outbox to rebuild indexes.
- **Media:** S3-compatible object storage (MinIO locally and on-prem).
- **Calls:** LiveKit (self-hostable SFU; egress produces recordings).
- **Local AI (reference stack):** Ollama serving a small Qwen model for
  generation + a local embedding model; a Parakeet ASR sidecar for
  transcription. Details in §6/§7.

Everything above runs in one `docker-compose up` (§10).

## 5. Data model (conceptual)

Deliberately minimal — this is the *shape*, not a finished schema. Tables get
created when the feature that needs them lands, not before. No speculative
columns, no "we might need it" indirection.

### Messaging plane (source of truth)
- `orgs`, `users`, `org_members` (role)
- `channels` (org, type: public/private/dm, topic), `channel_members`
- `messages` (channel, author, parent_message_id for threads, body as rich
  text JSON, created/edited/deleted timestamps)
- `reactions`, `attachments`, `link_references`
- `huddles` (channel, started_by, timestamps, recording status),
  `huddle_participants` (join/leave times)
- `transcript_segments` (huddle, speaker user_id, t_start/t_end, text) —
  the unit of citation and retrieval for calls

### Knowledge plane (derived, rebuildable)
- `knowledge_items` — the unifying abstraction. One row per retrievable chunk:
  `(id, org, source_type: message|transcript_segment|doc_chunk|code_ref,
  source_id, text, acl_ref, embedding vector, embedding_model_version,
  tsvector, metadata jsonb)`
  - `acl_ref` points at the governing permission scope (e.g. channel id) so
    retrieval filters by "channels this user can read" in one join
- `entities` — extracted topics/systems/projects with alias resolution
- `item_entities` — which items mention which entities
- `expertise_signals` — `(user, entity, signal_type, weight, evidence_item_id,
  occurred_at)`; "who knows about X" = time-decayed sum per user per entity,
  **always presented with the evidence items**, never as a bare score

Key property: the whole knowledge plane can be dropped and rebuilt from the
messaging plane. Never migrate derived data; regenerate it. This makes
"swap the embedding model" a batch job and GDPR deletion tractable.

### Retrieval flow for an Ask query
1. Query → embed + keyword-parse (via AI gateway)
2. Hybrid search over `knowledge_items`, **filtered by the asker's ACLs**
3. Entity linking on the query → expertise rankings + related items
4. Rerank, assemble typed result groups (people / threads / docs / code)
5. LLM synthesizes the brief with mandatory citations to item ids
6. Log the query + retrieved items (auditability)

## 6. AI integration & sovereignty

### The AI Gateway
One internal service owns all model access, exposing capability interfaces:

```ts
interface LLMProvider    { generate(req): Stream<Tokens>; }
interface Embedder       { embed(texts: string[]): Promise<Vector[]>; }
interface Transcriber    { transcribe(audio, opts): Promise<Segments>; }
interface Reranker       { rerank(query, docs): Promise<Scores>; }
```

Providers are deployment configuration, not code. The gateway also centralizes
rate limiting, cost accounting, prompt/version management, and audit logging.

### Reference stack: fully local (the default we build against)

| Capability | Model | Runtime | Notes |
|-----------|-------|---------|-------|
| Generation | Qwen3 small (8B; 4B on weaker laptops) | Ollama | Strong small-model quality; verify exact tag at build time |
| Embeddings | Local embedding model via Ollama (e.g. nomic-embed / Qwen embedding) | Ollama | Pin `embedding_model_version` on every item |
| Transcription | `nvidia/parakeet-tdt-0.6b-v3` | Python sidecar (NeMo or ONNX export) behind the Transcriber interface | Very fast, multilingual (25 European languages — good EU fit), CPU-capable |
| Rerank | Small cross-encoder, or skip in v0 | — | Rank fusion alone first; add reranking when eval shows it pays |

Design consequence: **assume the weakest model.** Prompts, retrieval, and UX
must produce good results on an 8B model. Do more work in retrieval/ranking
(deterministic, cheap) and less in the LLM. If it works on Qwen3-8B locally,
frontier models are pure upside.

A nuance worth being explicit about with customers: *weight provenance* and
*data flow* are different questions. Qwen is Chinese-developed, but running
open weights locally sends no data anywhere. Some EU orgs will still object on
principle — which is exactly why model choice is per-deployment config
(swap in Mistral weights, same architecture).

### Upgrade tiers (same product, different config)

| Tier | Where models run | Data boundary |
|------|------------------|---------------|
| **A. Sovereign self-hosted** (reference) | Customer infra: Ollama/vLLM + Parakeet | Nothing leaves customer infra |
| **B. EU-cloud managed** | EU providers (Mistral AI, EU-region endpoints) | EU jurisdiction |
| **C. Best-model** | Frontier APIs for orgs that permit it | Standard DPA terms |

### Trust & governance
- Admin-visible registry: exactly which models run where, on what data
- Full audit log: every AI query, what was retrieved, what was generated
- Right-to-erasure: deleting a message/user cascades into `knowledge_items`
- Recording consent: workspace policy + visible indicators + per-huddle opt-out

## 7. Huddles → knowledge pipeline

1. Huddle starts → LiveKit room; recording state visible to all participants
2. Egress writes audio to object storage (per-track where possible —
   diarization is nearly free when speakers are already on separate tracks)
3. Worker: transcribe via Parakeet sidecar → align speakers →
   `transcript_segments`
4. LLM pass (local Qwen): summary, decisions, action items, entity extraction
   → posted back into the channel as a thread (human-visible artifact)
5. Segments flow into `knowledge_items` like messages — a decision made
   verbally in a call is now findable, citable, and attributable

Headline feature: in Slack, huddle content evaporates. Here it becomes
first-class organizational memory — and because transcription is local,
raw call audio never leaves the deployment (later: never leaves the device, §9).

## 8. DMs, privacy, and the "speak freely" problem

Tension: DM content is often the highest-value knowledge in a company, but
people also need spaces to speak honestly — about a struggling project, a
difficult manager — without it entering the permanent, searchable record.
If indexing DMs makes people stop being honest in them, we've destroyed the
very knowledge we wanted to capture.

Resolution: **tiered visibility, conservative defaults, worker-visible state.**

- **Tier 0 — not indexed (v1 default for all DMs).** DMs never enter the
  knowledge plane. Full stop.
- **Tier 1 — signals only (future).** With both parties' opt-in: extract only
  entities/keywords ("these two people discuss the payments service"), never
  the text. Powers "who to talk to" routing without exposing what was said.
  Extraction should run on-device (§9) so raw text never reaches the server's
  knowledge plane at all.
- **Tier 2 — fully indexed (future).** Explicit per-conversation opt-in by all
  participants; revocable (revocation triggers reindex-delete, which the
  rebuildable knowledge plane makes cheap).
- **Off-the-record marker (future).** Any thread/DM can be flagged sensitive:
  excluded from indexing regardless of tier, optional shorter retention.

The current tier is always visible in the conversation UI — no one should ever
wonder whether the AI is listening. v1 ships Tier 0 only; the rest is roadmap.

## 9. Desktop app direction

Usage reality: Slack lives as a desktop app; ours will too. The desktop shell
is also where the deepest sovereignty story lands: **on-device AI** — local
transcription and small local decisions that never touch a server.

Approach:
- **Dev loop stays in the browser** (Vite + hot reload). The web app is the
  product; the desktop shell wraps it. This keeps iteration speed and makes
  the shell a deliverable, not a dependency.
- **Shell: Electron** (fits the Node/TS skill set; mature ecosystem for audio
  capture and native modules). Tauri is the fallback if bundle size/memory
  becomes a real complaint — the web-first architecture keeps that door open.
- **The shell's unique jobs** (things a browser can't do):
  - Mic/system-audio capture for huddles with OS-level indicators
  - Manage local AI sidecars (Ollama, Parakeet) — install, update, health
  - **On-device transcription**: transcribe locally, send only text + speaker
    segments to the server; raw audio never leaves the machine
  - **On-device small decisions**: e.g. the sensitivity classifier for §8
    Tier 1 — the model that decides "this is sensitive, index keywords only"
    runs on the user's machine, so unindexed content is never seen server-side
  - Notifications, global shortcuts, tray presence
- **Architectural prep now, shell later:** the AI Gateway gets a *device-local
  provider* slot, and clients advertise capabilities ("I can transcribe
  locally") so the server can skip its own ASR when the device already did it.

## 10. Local development, seed data, and testing

### One command up
`docker-compose up` (or `pnpm dev` wrapping it) starts: Postgres+pgvector,
Redis, MinIO, LiveKit, Ollama (pulls pinned models on first run), the Parakeet
sidecar, API, workers, and the Vite dev server. A `--no-ai` profile skips the
model containers for pure chat-UI work on low-spec machines.

### Seed corpus — the heart of local dev
Random faker text is useless for testing retrieval — semantic search over
gibberish proves nothing. Instead:

- **A curated, checked-in corpus**: a fictional ~25-person company with teams,
  channels, and several months of *coherent storylines* — an incident and its
  postmortem, a database migration debated across three channels, a new-hire
  onboarding, a huddle transcript where a decision gets made verbally.
  Generated once with a strong LLM, then reviewed and committed as data files
  (deterministic, no generation step in the dev loop).
- **A loader** (`pnpm seed`) that inserts it and runs the ingestion pipeline,
  so a fresh checkout has a working Ask surface in minutes.
- **Volume filler** (faker, seeded/deterministic) only for load and pagination
  testing — never for retrieval quality.

### The corpus doubles as an eval set
A checked-in set of **golden questions** with expected results:
"who knows about the payments migration?" → expect Priya + the #eng-payments
thread from the incident storyline. These run as integration tests: retrieval
changes that break golden questions fail CI. This is how we make "the AI got
worse" a test failure instead of a vibe.

### Testing & code-health gates (CI-enforced)
- **Vitest** for unit tests; integration tests against real Postgres
  (testcontainers) — the retrieval/ACL logic is SQL-heavy, mocks would lie
- **ACL leak tests are non-negotiable**: a standing suite that asserts a user
  can never retrieve knowledge items from channels they can't read
- `tsc --noEmit` strict + ESLint
- **Fallow** (`npx fallow dead-code`, `npx fallow dupes`) in CI and in the
  agent loop via its MCP integration — unused exports and duplicated logic are
  build failures, which is the structural answer to AI code-noise accretion
- Golden-question evals (above) as the retrieval-quality gate

## 11. What we deliberately do NOT build (for now)

- Slack integration or import — decided out of scope
- Apps/platform/workflow builder
- Email bridging, guest/multi-org channels
- Fine-tuning per-customer models (retrieval quality beats fine-tuning here)
- Mobile apps (responsive web / PWA first)
- Separate search infrastructure (Postgres hybrid search until it breaks)

## 12. Open questions

1. **Realtime sync approach** — raw WS + our own protocol, or a sync engine
   (Zero/Electric/Replicache) for the local-first client cache? Affects
   offline UX and engineering cost materially.
2. **Exact local model tags** — Qwen3 size/quantization and the embedding
   model need empirical picks on real hardware once the eval set exists.
3. **Diarization without per-track audio** — if LiveKit egress gives mixed
   audio in some setups, do we need a diarization model, or do we constrain
   recording to per-track?
4. **Expertise-ranking transparency** — users see their own inferred profile
   and can correct it? (Proposed: yes.)
5. **When does the desktop shell start?** Proposed: after the knowledge plane
   proves itself (build order step 5), unless on-device transcription becomes
   the demo that matters sooner.

## 13. Build order

1. **Skeleton**: monorepo, docker-compose, auth, orgs/channels/messages,
   realtime sync, React client — plus CI gates (tsc, ESLint, Fallow, Vitest)
   from the very first commit
2. **Seed corpus + loader**: the fictional company, `pnpm seed`, golden
   questions written down (failing) as the target
3. **Knowledge plane v0**: outbox → workers → `knowledge_items`, hybrid
   search; Ask surface over chat history with citations + ACL filtering;
   local AI via Ollama (Qwen + embeddings); golden-question evals green
4. **People layer**: entity extraction + expertise signals → "who to talk to"
5. **Huddles**: LiveKit + recording + Parakeet transcription pipeline →
   transcripts in the knowledge plane
6. **Desktop shell**: Electron wrapper, local sidecar management, on-device
   transcription
7. **Connectors + sovereignty hardening**: GitHub, docs source; provider
   matrix, self-host packaging, audit/governance surfaces

## 14. Direction change: peer-to-peer on the Pears stack

Decision (2026-07-03): Frith's desktop future is **peer-to-peer**, built on the
Pears stack (Hyperswarm for discovery + e2e-encrypted transport; Hypercore/
Autobase for append-only, multi-writer logs). This is the sovereignty
principle taken to its logical end: there is no server to trust because there
is no server — every peer holds the data, and the AI runs on-device (§9's
Electron shell now becomes the *primary* target, not a wrapper phase).

Staged migration, so the product keeps working at every step:

1. **Spike (done)** — `spikes/pear-chat`: Electron + Hyperswarm chat;
   headless smoke test proves peers meet over the DHT and exchange messages
   with no server (`npm run smoke`).
2. **Persistence — first pass done in the spike:** signed per-author
   sequences in a local append-only log, heads-exchange backfill between
   peers, forgery rejection (all smoke-tested). Next: swap the hand-rolled
   log for Hypercore per writer + Autobase ordering; Hyperbee for
   profile/channel metadata. A workspace becomes an invite key, not a
   tenant row.
3. **Port the messaging plane — done (2026-07-03).** The entire app now runs
   on an Autobase log (Corestore persistence, Hyperswarm replication,
   blind-pairing invites → writers). Postgres, Docker, and the custom
   signed-frame bridge are deleted; the server materializes state in memory
   from the linearized ops, and retrieval runs over that state.
4. **Knowledge plane goes local** — each peer indexes what it can see into
   a local store (SQLite + embeddings on-device). The ACL property becomes
   *physical*: you literally never receive data you weren't granted.
   Blind-ish helper peers (always-on seeders) are config, not architecture.

Open questions: identity/keys per user (device key pairs + profile signing),
read-state sync across own devices, and how far Autobase ordering gets us
before we need explicit causal metadata.

## 15. The social layer

Work chat that knows *who people are*, not just what they typed. Profiles
gain a fun side — both entirely opt-in and public-by-choice:

- **Into** — interest tags ("dogs", "rollerblading", whatever)
- **Currently enjoying** — the music / series / rabbit hole of the week

On top of that, the **social matcher**: "find your people" on Home suggests
people who share your interests and — when ≥3 of you overlap — proposes
starting a group chat (or joining the existing #interest channel). v0 is
deterministic tag overlap; the embedding model later upgrades matching to
semantic ("vinyl" ≈ "record collecting"). Principles:

- Suggestions only ever draw on what people chose to put on their profile.
- The matcher proposes, never auto-creates. No engagement-bait mechanics.
- Same trust posture as everything else: the suggestion UI says why
  ("3 of you are into rollerblading") — evidence, not vibes.

### Profiles as pages + the feed (shipped 2026-07-10)

The C2C turn made concrete: profiles grew a **bio**, **links** (blog,
socials, anywhere — platform icons detected client-side from the hostname,
purely cosmetic), an **accent color** that re-scopes the accent variable for
that person's profile page (banner, buttons, chips — visiting a profile means
stepping into their colour), and a **photo wall** of images they've shared in
channels the viewer can read.

**The feed** (`GET /api/feed`, Feed in the sidebar, `/feed`) is the
anti-algorithm answer to "keep me scrolling": what your people shared —
links, photos, doc updates, "currently enjoying" changes — strictly
chronological, capped, with an explicit end ("you're all caught up").
No ranking, no engagement weighting; §15's no-engagement-bait principle is
load-bearing here. Scope mirrors profile pages: ACL-filtered, never DMs (not
even your own), never archived channels; locked messages decrypt to '' and
contribute nothing. Links are **not unfurled** — previews would mean every
reader's device pinging the linked site; the poster's text plus the domain
pill is the card. `nowPlayingAt` (stamped server-side only when the value
changes) is what dates "enjoying" items.

**Profile pages are social-first (2026-07-10):** hero (banner, bio, links),
an intro column (interests, photos, compact stats), and a tabbed main column
— **Feed** (their personal timeline, `GET /api/users/:id/feed`, same
ACL/DM/locked guarantees as the space feed) is the default; the Slack-ish
material (useful posts, recent activity, artifacts) lives one tab over in
**Chats**, and **Groups & people** holds team + channels. Clicking a person
leads with who they are, not their message count.

### The community directory (v0 shipped 2026-07-10)

The C2C growth surface: public communities broadcasting what they're about,
so people can find their crowd. The structure that keeps it honest:

- **A directory is a feed, not a service with users.** The app fetches a
  JSON document from `FRITH_DIRECTORY_URL` (server-side, schema-validated,
  size-capped; a bundled sample ships for dev and to document the format).
  Anyone can host one on any static host — there is no account, no tracking,
  and the directory never learns who you are or what spaces you're in.
- **Entries are display + capability, nothing more:** name, description,
  interest tags, advisory member count, host, and optionally an invite key
  for open-join communities (otherwise "ask the host"). Joining uses the
  normal invite flow; the space itself still syncs peer-to-peer between its
  members. A directory can *list* a space; it cannot *see into* one.
- **Trust is per-directory, like a package registry.** You choose which
  curator's list to point at. Roadmap hardening: curator-signed entries
  (the "signed Autobase feed" from the roadmap), multiple directories at
  once, and a submit-your-space flow where listing publishes only what the
  space's owner explicitly broadcasts.
- **Open-join at scale is bounded by the invite model today** — an invite
  key in a public directory admits anyone who finds it, so open communities
  should pair with the seeder + moderation roles, and truly public
  mega-spaces (Discord-server scale) remain future work (writer-count and
  full-log-replication limits, ROADMAP §2).

## 16. Security & trust model (P2P era)

People will not put honest work conversations into a system they don't
trust. In the P2P design, trust comes from cryptography and physics, not
from a vendor's promise. What we have, what we owe, and what we won't
pretend about:

### Already true in the spike (verified by `npm run smoke`)
- **Transport encryption.** Every peer connection is end-to-end encrypted
  (Hyperswarm's Noise handshake). There is no middlebox to compromise
  because there is no middle.
- **Authenticated authorship.** Each device holds an ed25519 keypair
  (created locally, never transmitted; secret key stored 0600). Every
  message is signed; peers verify before storing or displaying. The smoke
  test includes an attacker impersonating another peer — the forgery is
  rejected.
- **Local-first storage.** History exists only on participants' machines.
  "Where is my data?" has a one-word answer: here.

### Owed before real use (roadmap, in rough order)
1. **Membership as capability.** Today anyone who knows the room string can
   derive the DHT topic and join. Real rooms need high-entropy invite keys
   (unguessable topic) plus a membership list signed by the room creator:
   peers drop connections from keys without a valid membership proof.
2. **Content keys & real revocation — SHIPPED (2026-07-06, §18).** Message
   content, attachment names, and attachment bytes are encrypted under
   rotating per-domain content keys, sealed per-member-device. Evicting a
   member rotates every key they could read; removing someone from a private
   channel rotates just that channel's. The invite rotates through the log so
   every admitting device drops the old QR.
3. **Encryption at rest — SHIPPED (2026-07-05, §17).** The log, blob cores,
   and registry (pairing credentials, identity seeds) are encrypted; key
   custody via Electron safeStorage / `FRITH_MASTER_KEY` / a 0600 key file.
4. **Identity beyond one device — SHIPPED (2026-07-05, §17).** Per-user root
   key certifies device keys; seed handoff links a second device; signed
   revocation ejects a stolen one. Fingerprint-verification UX still to do.
5. **Deletion honesty.** Tombstones propagate deletes, and honest peers
   honor them — but P2P cannot *force* a malicious peer to forget, same as
   a screenshot today. We say this plainly rather than promising GDPR
   erasure magic we can't deliver against adversarial peers.

### Standing risks to keep naming
- **Metadata.** The DHT reveals that some IP participates in some topic
  (not content). Mitigations later: relay peers, Tor-friendly transports.
- **Compromised endpoint.** If a member's device is owned, that member's
  view is owned — true of every E2E system; at-rest encryption and
  fingerprint verification limit blast radius.
- **The AI stays local.** On-device models mean the knowledge plane never
  creates a new exfiltration path; any optional remote model must be an
  explicit, per-workspace, clearly-labeled opt-in (§6 tiers unchanged).
- **Supply chain.** Dependency review on the P2P stack, lockfiles pinned,
  and (once on Pear) app distribution is itself key-verified.

## 17. Identity & key custody (shipped 2026-07-05)

The security foundation slice, in three layers. Dev iteration is untouched:
the pick-a-user cookie login stays in dev builds; everything below is how
**production** builds behave (`FRITH_MODE=production`, set by the packaged
desktop app).

### Keys

```
Device master key (32 B, never leaves the machine)
├─ custody: Electron safeStorage → FRITH_MASTER_KEY env → 0600 key file
└─ HKDF → file key (AES-256-GCM) → encrypts spaces.json
      (which now holds: pairing credentials, space log keys, identity seeds)

Space log key (32 B, shared by members)
├─ minted by the founder at createSpace()
├─ handed to joiners INSIDE the blind-pairing handshake (invite = capability)
└─ encrypts every hypercore block — writer cores, views, blob cores —
   at rest AND on the wire (hypercore encrypts blocks, not connections)

User root key (ed25519, seed generated at profile creation)
├─ certifies device keys: the Autobase writer key IS the device key
│    ops: identity (first-write-wins) / device / device-revoke (sticky)
├─ moves between YOUR devices as a handoff code (raw seed, out of band,
│    never in the log; /devices in the app)
└─ revokes a stolen device: signed op; honest peers drop the binding
```

The reducer tracks `deviceOwners` (writer key → user) and stamps every
message `verified` when the appending device provably belongs to the claimed
author. Spoofed authorship is **flagged, not blocked** — enforcement needs
the roles model (next slice, with org-wide ban + channel keys).

### What we say plainly

- **Encryption applies to spaces created from this version.** Hypercore's
  merkle tree is built over ciphertext, so an old plaintext space cannot be
  encrypted in place; migration = create a new space (log replay tool
  later). Old spaces still open.
- **Eviction now rotates content keys (§18).** A removed member keeps the
  history already on their disk and the block key, but new message content is
  encrypted under a fresh content key they are not sealed into — so they can't
  read anything new. The residual leak is *metadata*: because the Hypercore
  block key can't be rotated, a device that keeps replicating still sees that
  ops exist (author, channel, timestamp, ciphertext length). Content is hidden;
  activity is not.
- **Root seed loss = identity loss.** No recovery in this slice.
- **Loopback is the prod auth boundary.** The server runs in-process and
  binds 127.0.0.1; requests act as the device's bound user. A cookie adds
  nothing an attacker with *local* access couldn't already take. The one
  attacker who is *not* local but can still reach the port is any web page the
  user visits (it can `fetch`/`WebSocket` to `http://127.0.0.1:<port>`), so the
  API rejects requests whose `Host` isn't localhost (defeats DNS rebinding) or
  whose `Origin` is foreign (defeats cross-site fetch and WebSocket hijacking),
  and the dev cookie is `HttpOnly; SameSite=Strict`. A hosted edge sets
  `FRITH_TRUSTED_ORIGIN` to add exactly one allowed origin.

### Seeder & mobile direction

The **seeder** (`apps/seeder`) is a headless always-on peer: full log +
all blob bytes, no user, no API. Self-host it on a VPS/NAS/Pi for 24/7
sync; a hosted per-org/per-profile seeder is the monetization candidate.
Honest note: a seeder holds the space key (it's a member), so its host is
trusted like a member device — blind seeding needs per-core serve control.

**Mobile** is a native app on the Pears stack later — Keet.io proves the
runtime works on phones. The shape: phone = light peer that syncs from a
seeder on open, woken by a push relay that carries only an encrypted
"activity" ping (no plaintext through the relay). Not in scope yet.

## 18. Cryptographic revocation (shipped 2026-07-06)

Removing someone is now real, not cosmetic. The mechanism is a second
encryption layer *above* the space block key, distributed entirely through the
log — no changes to the pairing handshake.

### Content keys & domains

- A **content key** (32 B, AES-256-GCM) encrypts message bodies (sent and
  scheduled), attachment names, and attachment bytes. A key is named
  `keyId = hash(key)`, which makes every wrap self-verifying: a recipient only
  accepts an unwrapped key whose hash matches.
- A **domain** is a set of devices sharing a keychain. `space` covers all
  members (public channels); every private channel and DM is its own
  `channel:<id>` domain — so removal locks exactly the right scope, and a DM
  with someone in *this* space says nothing about your channels elsewhere.
- Each device publishes an **X25519 encryption key**, folded into its
  root-signed device binding so it can't be spoofed. Content keys are sealed to
  those keys with libsodium `crypto_box_seal`.

### Three ops carry keys (see `state.ts` / `space.ts`)

```
epoch         — signed rotation: a new current key for a domain, sealed to its
                member devices. Managers rotate anything; a private channel's
                members rotate their own channel. The signature binds the wraps
                (wrapsHash), so a copied op with altered wraps is discarded.
grant         — unsigned but self-verifying: seals an existing key to one more
                device (newcomer onboarding). Safe without a signature because
                a false key can't hash to the advertised keyId. Refused for
                devices outside the domain; never overwrites an existing wrap.
invite-rotate — signed: new blind-pairing credentials for every admitting
                device, the invite secret sealed per member device. All honest
                peers rebind, so the old QR dies everywhere — not just on the
                device that evicted.
```

Authorization is **root-signature-based, not writer-based**, for `evict` and
`epoch`: the op names its actor and the actor's root signs it. This is
replay-safe because eviction is sticky and epochs are idempotent by keyId /
monotone by seq. (`role` and `setting` stay writer-coupled: they toggle, so a
replayed old op must not re-apply.)

Determinism under Autobase reorder: keys are chosen by `(seq, keyId)` total
order, never wall-clock; concurrent rotations converge and every past key stays
decryptable (keyId lookup). Unwrapped keys live in the encrypted registry,
re-derived from the log on rebuild → idempotent.

### Reconcile: the healing loop

After every drain, each device runs a bounded reconcile pass: (1) if a domain's
current key is still sealed to a device that left the domain, any local
identity allowed to rotate mints a fresh key — this is why removal works no
matter WHICH peer performed it; (2) keys this device holds are sealed to member
devices missing them, respecting `historyVisibility` (`full` hands newcomers
the whole keychain, `join-forward` only the current key).

### Roles & eviction

Owner = author of the first `identity` op. The owner grants `admin` (signed
`role` op); owner/admins may `evict`. Eviction: revoke the user's devices, drop
their memberships, rotate the space key AND every private-channel key they held,
and rotate the invite. Removing someone from one private channel rotates just
that channel's key. The privileged API surface (evict, admins, settings, logo)
requires an authenticated user; the pre-login exemption is an enumerated list
(see routes.ts preHandler), not a prefix match.

### The honest limitations

- The block key can't rotate, so eviction hides **content**, not **metadata**:
  a removed device that keeps replicating still sees that messages exist and
  their envelope (author, channel, time, size). Total invisibility would
  require every member to re-pair into a fresh log.
- A malicious *current* member can leak keys or plaintext outright — collusion
  is unpreventable, same as screenshots. Grants are first-write-wins per
  device, so an insider can grief a newcomer's onboarding wrap (self-heals for
  epoch wraps, which the signature binds).
- Invite rotation reaches honest peers; a malicious member could keep admitting
  on old credentials it saved. Admission ≠ access: newcomers still only get
  keys via grants, which exclude the evicted.

## 19. Recording & transcription consent (shipped 2026-07-06)

Campfires can be recorded, and the posture is consent-forward:

- **Recording is an in-call act.** Only a current participant can flag
  recording (server-enforced, 409 otherwise), and stopping/leaving clears the
  flag — a stale REC can never haunt a room.
- **Everyone always knows.** The recorder confirms an explicit consent prompt;
  every participant sees a pulsing "Recording · name" banner; the channel's
  Join button carries a REC dot so nobody walks into a recorded call blind.
- **The file stays in the room.** Recording happens on the recorder's device
  (mixed call audio; plus the shared screen when one is on stage) and is
  posted to the channel as a normal sealed attachment — same encryption,
  same ACL as any file. Nothing streams to any service.
- **Transcription is local or it doesn't happen.** The live-transcript add-on
  runs Whisper in the browser via `@huggingface/transformers` (lazy-loaded;
  model cached after first download). Call audio never leaves the device —
  the only posture consistent with content that's sealed end-to-end.
  Transcripts are posted to the channel only by explicit click.

## IP posture (vs. Slack and other incumbents)

Reviewed 2026-07-05 against Slack's Brand Terms of Service and general
trademark/trade-dress/copyright principles. Not legal advice; get counsel
before commercial distribution. The standing rules:

- **Never use "Slack" in the product name, domains, app-store listings, or
  advertising** (incl. search keywords). Their brand terms prohibit it, and
  it's the one bright line. The public repo, product name ("Frith"), logo
  (campfire), and landing page are Slack-free — keep them that way.
- **Truthful comparisons in prose are fine** (nominative fair use — the
  Mattermost/Rocket.Chat pattern). This document's comparative references
  stay; marketing copy should sell the P2P story, not the resemblance.
- **Concepts are not protectable**: channels, threads, DMs, workspaces are
  unprotected methods of operation (Lotus v. Borland line of cases) with
  decades of prior art (IRC, HipChat). No exposure there.
- **Trade dress is the only real watch item**: Slack's signature is the
  dark-aubergine sidebar (hue ~299°). Ours (default 'ocean'): light blue-grey
  channel sidebar, deep slate rail (`--rail`, hue ~207°, deliberately not
  purple), tile home, campfire brand. Keep future themes' dark chrome off the
  magenta-purple family.
- **We use no Slack APIs or services**, so their ToS/AUP/API terms don't
  bind us. If an import-from-Slack feature ever lands (currently out of
  scope), it must go through their export formats + API terms review.
