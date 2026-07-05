import type { AskEvidence, AskFileHit, AskLocalHit, AskPerson, AskResponse, AskThread, TaskScopeDto, UserDto } from '@app/shared';
import { channelName, filesVisibleTo, messagesVisibleTo, userDtoById } from './store.js';
import type { MessageRow } from '../space/state.js';
import { space } from '../space/space.js';
import { extractArtifacts } from './artifacts.js';
import { library } from './library.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'was', 'be',
  'i', 'we', 'you', 'it', 'this', 'that', 'my', 'our', 'me', 'do', 'need', 'who', 'what',
  'how', 'where', 'with', 'about', 'should',
]);

function tokenize(query: string): string[] {
  return [...new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9_./-]+/)
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t)),
  )];
}

function occurrences(body: string, token: string): number {
  let count = 0;
  let idx = body.indexOf(token);
  while (idx !== -1) {
    count += 1;
    idx = body.indexOf(token, idx + token.length);
  }
  return count;
}

function makeSnippet(body: string, tokens: string[]): string {
  const lower = body.toLowerCase();
  const first = Math.min(...tokens.map((t) => lower.indexOf(t)).filter((i) => i !== -1), body.length);
  const start = Math.max(0, first - 60);
  let window = (start > 0 ? '…' : '') + body.slice(start, start + 170) + (start + 170 < body.length ? '…' : '');
  for (const token of tokens) {
    const pattern = new RegExp(`(${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    window = window.replace(pattern, '[[$1]]');
  }
  return window;
}

interface Hit {
  row: MessageRow;
  rank: number;
  snippet: string;
}

/**
 * Retrieval over the in-memory state: token scoring with an OR fallback for
 * verbose natural-language queries. ACL and blocks are applied by
 * messagesVisibleTo. Embeddings + LLM synthesis slot in on top later — the
 * result shapes stay the same.
 */
function retrieve(userId: string, query: string): { hits: Hit[]; people: AskPerson[]; threads: AskThread[] } {
  const tokens = tokenize(query);
  if (tokens.length === 0) return { hits: [], people: [], threads: [] };

  const rows = messagesVisibleTo(userId);
  const score = (row: MessageRow, required: 'all' | 'any'): number => {
    const lower = row.body.toLowerCase();
    const perToken = tokens.map((t) => occurrences(lower, t));
    if (required === 'all' && perToken.some((c) => c === 0)) return 0;
    return perToken.reduce((a, b) => a + b, 0);
  };

  let scored = rows
    .map((row) => ({ row, rank: score(row, 'all') }))
    .filter((h) => h.rank > 0);
  if (scored.length === 0 && tokens.length > 1) {
    scored = rows.map((row) => ({ row, rank: score(row, 'any') })).filter((h) => h.rank > 0);
  }
  const hits: Hit[] = scored
    .sort((a, b) => b.rank - a.rank)
    .slice(0, 40)
    .map((h) => ({ ...h, snippet: makeSnippet(h.row.body, tokens) }));
  if (hits.length === 0) return { hits: [], people: [], threads: [] };

  // People: sum relevance per author, keep their strongest evidence.
  const byAuthor = new Map<string, { user: UserDto; score: number; hits: Hit[] }>();
  for (const h of hits) {
    const user = userDtoById(h.row.authorId);
    if (!user) continue;
    const entry = byAuthor.get(user.id) ?? { user, score: 0, hits: [] };
    entry.score += h.rank;
    entry.hits.push(h);
    byAuthor.set(user.id, entry);
  }
  const evidence = (h: Hit): AskEvidence => ({
    messageId: h.row.id,
    channelId: h.row.channelId,
    channelName: channelName(h.row.channelId),
    snippet: h.snippet,
    createdAt: h.row.createdAt,
  });
  const people: AskPerson[] = [...byAuthor.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((entry) => ({ user: entry.user, score: entry.score, evidence: entry.hits.slice(0, 2).map(evidence) }));

  // Threads: group hits under their root message.
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const byRoot = new Map<string, Hit[]>();
  for (const h of hits) {
    const rootId = h.row.parentMessageId ?? h.row.id;
    byRoot.set(rootId, [...(byRoot.get(rootId) ?? []), h]);
  }
  const threads: AskThread[] = [...byRoot.entries()]
    .map(([rootId, rootHits]) => {
      const root = rowsById.get(rootId);
      if (!root) return null;
      const replies = rows.filter((r) => r.parentMessageId === rootId);
      const lastActivity = [root, ...replies].map((r) => r.createdAt).sort().at(-1)!;
      const top = rootHits.reduce((a, b) => (a.rank >= b.rank ? a : b));
      return {
        rootId,
        channelId: root.channelId,
        channelName: channelName(root.channelId),
        rootBody: root.body.length > 140 ? `${root.body.slice(0, 140)}…` : root.body,
        rootAuthorName: userDtoById(root.authorId)?.name ?? 'Unknown',
        matchCount: rootHits.length,
        topSnippet: top.snippet,
        lastActivityAt: lastActivity,
        _score: rootHits.reduce((s, h) => s + h.rank, 0),
      };
    })
    .filter((t): t is AskThread & { _score: number } => t !== null)
    .sort((a, b) => b._score - a._score)
    .slice(0, 6)
    .map(({ _score, ...t }) => t);

  return { hits, people, threads };
}

/**
 * Score this device's library (files, docs, commits) with the same tokens
 * the chat search uses. Results stay local — they're never shared into the
 * space, they just sit next to the chat evidence for whoever is asking.
 */
function searchLibrary(query: string): AskLocalHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  return library
    .allDocs()
    .map((doc) => {
      const lower = `${doc.ref}\n${doc.text}`.toLowerCase();
      const perToken = tokens.map((t) => occurrences(lower, t));
      const matched = perToken.filter((c) => c > 0).length;
      // Require most tokens to appear — code files are big enough that
      // single-token noise would drown the chat results otherwise.
      if (matched < Math.max(1, tokens.length - 1)) return null;
      const score = perToken.reduce((a, b) => a + b, 0) + matched * 5;
      return { doc, score };
    })
    .filter((h): h is NonNullable<typeof h> => h !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(({ doc }) => ({
      kind: doc.kind,
      sourceId: doc.sourceId,
      sourceName: library.sourceName(doc.sourceId),
      ref: doc.ref,
      title: doc.title,
      snippet: makeSnippet(doc.text, tokens),
      when: doc.when,
    }));
}

/**
 * Shared files, searched like messages: always by name; by content too for
 * text files whose bytes are on this device (own uploads or cached fetches —
 * search never pulls bytes from peers behind your back).
 */
async function searchFiles(userId: string, query: string): Promise<AskFileHit[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const textual = (mime: string) => mime.startsWith('text/') || mime === 'application/json';
  const scored: { hit: AskFileHit; score: number }[] = [];
  for (const a of filesVisibleTo(userId)) {
    const nameHits = tokens.map((t) => occurrences(a.name.toLowerCase(), t)).reduce((x, y) => x + y, 0);
    let content: string | null = null;
    if (textual(a.mime) && a.size <= 256 * 1024 && a.blob && space.blobs.isCachedSync(a.blob)) {
      const bytes = await space.blobs.get(a.blob, { expectedHash: a.hash }).catch(() => null);
      if (bytes) content = bytes.toString('utf8');
    }
    const contentHits = content
      ? tokens.map((t) => occurrences(content.toLowerCase(), t)).reduce((x, y) => x + y, 0)
      : 0;
    if (nameHits + contentHits === 0) continue;
    scored.push({
      score: nameHits * 5 + contentHits,
      hit: {
        attachmentId: a.id,
        channelId: a.message.channelId,
        channelName: channelName(a.message.channelId),
        name: a.name,
        kind: a.mime.startsWith('image/') ? 'image' : a.mime.startsWith('video/') ? 'video' : a.mime.startsWith('audio/') ? 'audio' : 'file',
        url: `/api/files/${a.id}`,
        snippet: content && contentHits > 0 ? makeSnippet(content, tokens) : null,
      },
    });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.hit);
}

export async function ask(userId: string, query: string): Promise<AskResponse> {
  const { hits, people, threads } = retrieve(userId, query);
  return {
    query,
    people,
    threads,
    files: await searchFiles(userId, query),
    messages: hits.slice(0, 8).map((h) => ({
      messageId: h.row.id,
      channelId: h.row.channelId,
      channelName: channelName(h.row.channelId),
      snippet: h.snippet,
      createdAt: h.row.createdAt,
    })),
    local: searchLibrary(query),
  };
}

export async function taskScope(userId: string, requirements: string): Promise<TaskScopeDto> {
  const { hits, people, threads } = retrieve(userId, requirements);
  return {
    query: requirements,
    matchCount: hits.length,
    people,
    threads,
    artifacts: extractArtifacts(
      hits.map((h) => ({ body: h.row.body, channelId: h.row.channelId, channelName: channelName(h.row.channelId) })),
    ),
  };
}
