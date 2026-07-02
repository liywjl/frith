import { useState } from 'react';
import type { AskResponse } from '@app/shared';
import { api } from './api';
import { Avatar } from './Avatar';
import { Snippet } from './Snippet';

const EXAMPLES = [
  'payments migration',
  'rate limit incident',
  'who owns the feature flag',
  'reconciliation job',
];

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function AskPanel({
  onClose,
  onOpenChannel,
  onOpenThread,
}: {
  onClose: () => void;
  onOpenChannel: (channelId: string) => void;
  onOpenThread: (rootId: string, channelId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<AskResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function run(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setQuery(trimmed);
    setLoading(true);
    try {
      setResult(await api.ask(trimmed));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="ask-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ask-input">
          <span className="ask-eyebrow">Ask</span>
          <input
            autoFocus
            value={query}
            placeholder="What do you need to know? People, threads, and decisions…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run(query);
            }}
          />
        </div>

        {!result && !loading && (
          <div className="ask-empty">
            <p>Search everything you're allowed to see — try:</p>
            <div className="ask-examples">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => void run(ex)}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}
        {loading && <div className="ask-empty">Searching…</div>}

        {result && !loading && (
          <div className="ask-results">
            <div className="ask-col">
              <div className="ask-h">Threads</div>
              {result.threads.map((t) => (
                <button key={t.rootId} className="ask-thread" onClick={() => onOpenThread(t.rootId, t.channelId)}>
                  <span className="ask-ref">
                    #{t.channelName} · {dateFormat.format(new Date(t.lastActivityAt))}
                    {t.matchCount > 1 ? ` · ${t.matchCount} matches` : ''}
                  </span>
                  <span className="ask-root">{t.rootAuthorName}: {t.rootBody}</span>
                  <span className="ask-snippet">
                    <Snippet text={t.topSnippet} />
                  </span>
                </button>
              ))}
              {result.threads.length === 0 && <div className="ask-none">No threads matched.</div>}

              <div className="ask-h">Messages</div>
              {result.messages.map((m) => (
                <button key={m.messageId} className="ask-message" onClick={() => onOpenChannel(m.channelId)}>
                  <span className="ask-ref">#{m.channelName} · {dateFormat.format(new Date(m.createdAt))}</span>
                  <span className="ask-snippet">
                    <Snippet text={m.snippet} />
                  </span>
                </button>
              ))}
              {result.messages.length === 0 && <div className="ask-none">No messages matched.</div>}
            </div>

            <div className="ask-col">
              <div className="ask-h">People</div>
              {result.people.map((p) => (
                <div key={p.user.id} className="ask-person">
                  <Avatar name={p.user.name} emoji={p.user.avatarEmoji} />
                  <div className="ask-person-body">
                    <div className="ask-person-name">{p.user.name}</div>
                    {(p.user.title || p.user.team) && (
                      <div className="ask-person-title">{[p.user.title, p.user.team].filter(Boolean).join(' · ')}</div>
                    )}
                    {p.evidence.map((e) => (
                      <div key={e.messageId} className="ask-evidence">
                        ↳ #{e.channelName}: <Snippet text={e.snippet} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {result.people.length === 0 && <div className="ask-none">No one matched.</div>}
            </div>
          </div>
        )}

        <div className="ask-foot">
          <span>only sources you can read</span>
          <span>retrieval: Postgres FTS · synthesis: coming with local models</span>
        </div>
      </div>
    </div>
  );
}
