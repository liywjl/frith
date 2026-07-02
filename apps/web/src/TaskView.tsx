import { useState } from 'react';
import type { TaskScopeDto } from '@app/shared';
import { api } from './api';
import { Avatar } from './Avatar';
import { UserHover } from './UserHover';
import { useUserActions } from './userActions';
import { Snippet } from './Snippet';
import { ArtifactChips } from './ArtifactChips';
import { ThreadCard } from './ThreadCard';

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

const EXAMPLE =
  'Add the EU cutover date to the payments migration reconciliation job';

export function TaskView({
  onOpenChannel,
  onOpenThread,
}: {
  onOpenChannel: (channelId: string) => void;
  onOpenThread: (rootId: string, channelId: string) => void;
}) {
  const { openDm } = useUserActions();
  const [requirements, setRequirements] = useState('');
  const [result, setResult] = useState<TaskScopeDto | null>(null);
  const [loading, setLoading] = useState(false);

  async function scope(text: string) {
    const trimmed = text.trim();
    if (trimmed.length < 3) return;
    setRequirements(text);
    setLoading(true);
    try {
      setResult(await api.taskScope(trimmed));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="main home">
      <div className="home-scroll">
        <header className="home-head">
          <h1>Start a task</h1>
          <p>Describe what you need to do — Lore scopes out who to talk to, what's been discussed, and where the code and docs live.</p>
        </header>

        <div className="task-input">
          <textarea
            autoFocus
            rows={3}
            value={requirements}
            placeholder={`e.g. "${EXAMPLE}"`}
            onChange={(e) => setRequirements(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void scope(requirements);
            }}
          />
          <div className="task-input-foot">
            <button className="btn ghost" onClick={() => void scope(EXAMPLE)}>
              Try the example
            </button>
            <button className="btn primary" disabled={loading || requirements.trim().length < 3} onClick={() => void scope(requirements)}>
              {loading ? 'Scoping…' : 'Scope this task ⌘⏎'}
            </button>
          </div>
        </div>

        {result && !loading && (
          <>
            <p className="task-count">
              {result.matchCount === 0
                ? 'Nothing in the record matches yet — you may be first. Ask in a public channel so the next person finds it.'
                : `Grounded in ${result.matchCount} messages you have access to.`}
            </p>

            {result.people.length > 0 && (
              <section>
                <div className="home-h">People to talk to</div>
                {result.people.map((p) => (
                  <div key={p.user.id} className="task-person">
                    <UserHover userId={p.user.id} name={p.user.name}>
                      <Avatar name={p.user.name} emoji={p.user.avatarEmoji} />
                    </UserHover>
                    <div className="task-person-body">
                      <b>{p.user.name}</b>
                      <span className="ask-person-title">{[p.user.title, p.user.team].filter(Boolean).join(' · ')}</span>
                      {p.evidence[0] && (
                        <span className="ask-evidence">
                          ↳ #{p.evidence[0].channelName}: <Snippet text={p.evidence[0].snippet} />
                        </span>
                      )}
                    </div>
                    <button className="btn primary" onClick={() => openDm(p.user.id)}>
                      Message
                    </button>
                  </div>
                ))}
              </section>
            )}

            {result.threads.length > 0 && (
              <section>
                <div className="home-h">Already discussed</div>
                {result.threads.map((t) => (
                  <ThreadCard
                    key={t.rootId}
                    channelName={t.channelName}
                    corner={<span className="home-when">{dateFormat.format(new Date(t.lastActivityAt))}</span>}
                    onClick={() => onOpenThread(t.rootId, t.channelId)}
                  >
                    <span className="home-snippet">
                      {t.rootAuthorName}: {t.rootBody}
                    </span>
                  </ThreadCard>
                ))}
              </section>
            )}

            <ArtifactChips title="Code & docs mentioned" artifacts={result.artifacts} onOpenChannel={onOpenChannel} />

            <div className="ask-foot task-foot">
              <span>only sources you can read</span>
              <span>retrieval: Postgres FTS · synthesis: coming with local models</span>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
