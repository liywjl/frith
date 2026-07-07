import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocFullDto, ServerEvent } from '@app/shared';
import { api } from '../lib/api';
import { useRealtime } from '../lib/useRealtime';
import { DocEditor } from '../components/DocEditor';
import { Icon } from '../components/Icon';

const savedFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * A shared doc: a Notion-style page over a markdown file, autosaved as you
 * type and synced to every peer as ops (whole-doc last-write-wins). The
 * space's living notes — agendas, decisions, runbooks — instead of pinning
 * them in scrollback.
 */
export function DocView({ docId, canManage, meId, onRemoved }: {
  docId: string;
  canManage: boolean;
  meId: string;
  onRemoved: () => void;
}) {
  const [doc, setDoc] = useState<DocFullDto | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // Bumped when a peer's edit replaces our clean copy — remounts the editor.
  const [editorEpoch, setEditorEpoch] = useState(0);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  // Callers pass inline closures; keep the latest without letting a new
  // identity re-run the load effect (that would clobber unsaved edits).
  const onRemovedRef = useRef(onRemoved);
  onRemovedRef.current = onRemoved;

  useEffect(() => {
    dirty.current = false;
    setDoc(null);
    api
      .doc(docId)
      .then((d) => {
        setDoc(d);
        setTitle(d.title);
        setBody(d.body);
        setEditorEpoch((n) => n + 1);
        // A freshly created page: start in the title, like Notion.
        if (d.title === 'Untitled' && !d.body) setTimeout(() => titleRef.current?.select(), 0);
      })
      .catch(() => onRemovedRef.current()); // opened a doc someone just deleted
  }, [docId]);

  // save must be identity-stable: the flush-on-unmount effect below runs its
  // cleanup whenever save changes, and a save closing over stale title/body
  // would write that stale copy on every keystroke. Read the latest via a ref.
  const latest = useRef({ title, body });
  latest.current = { title, body };
  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    const { title, body } = latest.current;
    const saved = await api.updateDoc(docId, { title: title.trim() || 'Untitled', body }).catch(() => null);
    if (saved) setDoc(saved);
  }, [docId]);

  // Autosave: settle for a moment, then write. Flush on unmount/switch.
  useEffect(() => {
    if (!dirty.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), 800);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [title, body, save]);
  useEffect(
    () => () => {
      void save();
    },
    [save],
  );

  // A peer edited this doc: refresh unless our own unsaved edits would be lost
  // (whole-doc last-write-wins; the next save wins the room).
  useRealtime((event: ServerEvent) => {
    if (event.type !== 'docs.changed' || event.docId !== docId) return;
    api
      .doc(docId)
      .then((d) => {
        setDoc(d);
        // Adopt the peer's copy only when it actually differs from what we
        // show — our own save echoes back as docs.changed, and a needless
        // editor remount would drop the caret.
        if (!dirty.current && (d.title !== title || d.body !== body)) {
          setTitle(d.title);
          setBody(d.body);
          setEditorEpoch((n) => n + 1);
        }
      })
      .catch(() => onRemovedRef.current());
  });

  const focusEditorStart = () => {
    const first = pageRef.current?.querySelector<HTMLElement>('.doc-block');
    first?.focus();
  };

  if (!doc) return <div className="doc-view" />;
  const mayRemove = canManage || doc.createdBy === meId;

  return (
    <div className="doc-view" ref={pageRef}>
      <div className="doc-toolbar">
        <span className="doc-meta">
          {savedFormat.format(new Date(doc.updatedAt))} · {doc.updatedByName}
        </span>
        <a className="doc-tool" href={`/api/docs/${docId}/file`} download title="Download as Markdown (.md)">
          <Icon name="download" /> .md
        </a>
        {mayRemove && (
          <button
            className="doc-tool danger"
            title="Delete for everyone"
            onClick={() => {
              if (window.confirm(`Delete “${doc.title}” for everyone?`)) {
                void api.removeDoc(docId).then(onRemoved);
              }
            }}
          >
            <Icon name="trash" />
          </button>
        )}
      </div>
      <div className="doc-page">
        <input
          ref={titleRef}
          className="doc-title"
          value={title}
          placeholder="Untitled"
          onChange={(e) => {
            dirty.current = true;
            setTitle(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'ArrowDown') {
              e.preventDefault();
              focusEditorStart();
            }
          }}
        />
        <DocEditor
          key={`${docId}:${editorEpoch}`}
          initial={body}
          onChange={(md) => {
            dirty.current = true;
            setBody(md);
          }}
        />
      </div>
    </div>
  );
}
