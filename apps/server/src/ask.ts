import { sql as raw } from 'drizzle-orm';
import type { AskEvidence, AskPerson, AskResponse, AskThread } from '@app/shared';
import { db } from './db/client.js';
import { visibleChannelIds } from './store.js';

interface Hit {
  id: string;
  channel_id: string;
  channel_name: string;
  author_id: string;
  author_handle: string;
  author_name: string;
  author_title: string | null;
  author_team: string | null;
  author_avatar_emoji: string | null;
  author_status_emoji: string | null;
  author_status_text: string | null;
  parent_message_id: string | null;
  body: string;
  created_at: Date;
  rank: number;
  snippet: string;
}

/**
 * Retrieval v0 for the Ask surface: Postgres full-text search over messages
 * the asker is allowed to read. People are ranked by summed relevance of what
 * they actually wrote (evidence attached); threads group hits by their root.
 * Embeddings + LLM synthesis slot in on top of this later — the ACL filtering
 * and result shape stay the same.
 *
 * Snippets mark query hits with [[double brackets]] (never HTML) so the
 * client can highlight by splitting, not by innerHTML.
 */
export async function ask(userId: string, query: string): Promise<AskResponse> {
  const channelIds = await visibleChannelIds(userId);
  if (channelIds.length === 0 || query.trim() === '') {
    return { query, people: [], threads: [], messages: [] };
  }

  async function search(tsQueryText: string): Promise<Hit[]> {
    const rows = await db.execute(raw`
      select m.id, m.channel_id, c.name as channel_name,
             m.author_id, u.handle as author_handle, u.name as author_name,
             u.title as author_title, u.team as author_team, u.avatar_emoji as author_avatar_emoji,
             u.status_emoji as author_status_emoji, u.status_text as author_status_text,
             m.parent_message_id, m.body, m.created_at,
             ts_rank(m.search, q)::float as rank,
             ts_headline('english', m.body, q,
               'StartSel=[[, StopSel=]], MaxFragments=1, MaxWords=28, MinWords=12') as snippet
      from messages m
        join users u on u.id = m.author_id
        join channels c on c.id = m.channel_id,
        websearch_to_tsquery('english', ${tsQueryText}) q
      where m.search @@ q
        and m.channel_id in (${raw.join(channelIds.map((id) => raw`${id}::uuid`), raw`, `)})
      order by rank desc
      limit 40`);
    return [...rows] as unknown as Hit[];
  }

  // Strict pass first (websearch ANDs terms). Natural-language questions often
  // over-constrain — e.g. "who owns the feature flag" requires the lexeme
  // 'own', which is an English stopword in documents and so never indexed.
  // If nothing matches, retry with OR semantics so the informative terms win.
  let hits = await search(query);
  const words = query.trim().split(/\s+/);
  if (hits.length === 0 && words.length > 1) {
    hits = await search(words.join(' or '));
  }
  if (hits.length === 0) return { query, people: [], threads: [], messages: [] };

  const evidence = (h: Hit): AskEvidence => ({
    messageId: h.id,
    channelId: h.channel_id,
    channelName: h.channel_name,
    snippet: h.snippet,
    createdAt: new Date(h.created_at).toISOString(),
  });

  // People: sum relevance per author, keep their strongest evidence.
  const byAuthor = new Map<string, { person: AskPerson; hits: Hit[] }>();
  for (const h of hits) {
    const entry = byAuthor.get(h.author_id) ?? {
      person: {
        user: {
          id: h.author_id,
          handle: h.author_handle,
          name: h.author_name,
          title: h.author_title,
          team: h.author_team,
          avatarEmoji: h.author_avatar_emoji,
          statusEmoji: h.author_status_emoji,
          statusText: h.author_status_text,
        },
        score: 0,
        evidence: [],
      },
      hits: [],
    };
    entry.person.score += h.rank;
    entry.hits.push(h);
    byAuthor.set(h.author_id, entry);
  }
  const people = [...byAuthor.values()]
    .sort((a, b) => b.person.score - a.person.score)
    .slice(0, 4)
    .map(({ person, hits: authorHits }) => ({
      ...person,
      score: Math.round(person.score * 1000) / 1000,
      evidence: authorHits.slice(0, 2).map(evidence),
    }));

  // Threads: group hits under their root message.
  const rootIds = [...new Set(hits.map((h) => h.parent_message_id ?? h.id))];
  const rootRows = await db.execute(raw`
    select m.id, m.body, m.created_at, u.name as author_name, m.channel_id, c.name as channel_name,
      (select coalesce(max(r.created_at), m.created_at) from messages r where r.parent_message_id = m.id) as last_activity
    from messages m join users u on u.id = m.author_id join channels c on c.id = m.channel_id
    where m.id in (${raw.join(rootIds.map((id) => raw`${id}::uuid`), raw`, `)})`);
  const roots = new Map(
    ([...rootRows] as unknown as {
      id: string;
      body: string;
      created_at: Date;
      author_name: string;
      channel_id: string;
      channel_name: string;
      last_activity: Date;
    }[]).map((r) => [r.id, r]),
  );

  const byRoot = new Map<string, Hit[]>();
  for (const h of hits) {
    const rootId = h.parent_message_id ?? h.id;
    byRoot.set(rootId, [...(byRoot.get(rootId) ?? []), h]);
  }
  const threads: AskThread[] = [...byRoot.entries()]
    .map(([rootId, rootHits]) => {
      const root = roots.get(rootId);
      if (!root) return null;
      const top = rootHits.reduce((a, b) => (a.rank >= b.rank ? a : b));
      return {
        rootId,
        channelId: root.channel_id,
        channelName: root.channel_name,
        rootBody: root.body.length > 140 ? `${root.body.slice(0, 140)}…` : root.body,
        rootAuthorName: root.author_name,
        matchCount: rootHits.length,
        topSnippet: top.snippet,
        lastActivityAt: new Date(root.last_activity).toISOString(),
        _score: rootHits.reduce((s, h) => s + h.rank, 0),
      };
    })
    .filter((t): t is AskThread & { _score: number } => t !== null)
    .sort((a, b) => b._score - a._score)
    .slice(0, 6)
    .map(({ _score, ...t }) => t);

  return { query, people, threads, messages: hits.slice(0, 8).map(evidence) };
}
