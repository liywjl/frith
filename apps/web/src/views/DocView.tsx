import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocFullDto, ServerEvent } from '@app/shared';
import { api } from '../lib/api';
import { useRealtime } from '../lib/useRealtime';

const savedFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * A shared doc: one always-editable page, autosaved as you type and synced to
 * every peer as ops (whole-doc last-write-wins). The space's living notes —
 * agendas, decisions, runbooks — instead of pinning them in scrollback.
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
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    dirty.current = false;
    setDoc(null);
    api
      .doc(docId)
      .then((d) => {
        setDoc(d);
        setTitle(d.title);
        setBody(d.body);
      })
      .catch(onRemoved); // opened a doc someone just deleted
  }, [docId, onRemoved]);

  const save = useCallback(async () => {
    if (!dirty.current) return;
    dirty.current = false;
    const saved = await api.updateDoc(docId, { title: title.trim() || 'Untitled', body }).catch(() => null);
    if (saved) setDoc(saved);
  }, [docId, title, body]);

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
        if (!dirty.current) {
          setTitle(d.title);
          setBody(d.body);
        }
      })
      .catch(onRemoved);
  });

  if (!doc) return <div className="doc-view" />;
  const mayRemove = canManage || doc.createdBy === meId;

  return (
    <div className="doc-view">
      <header className="doc-head">
        <input
          className="doc-title"
          value={title}
          placeholder="Untitled"
          onChange={(e) => {
            dirty.current = true;
            setTitle(e.target.value);
          }}
        />
        <span className="doc-meta">
          {savedFormat.format(new Date(doc.updatedAt))} · {doc.updatedByName}
        </span>
        {mayRemove && (
          <button
            className="btn"
            onClick={() => {
              if (window.confirm(`Delete “${doc.title}” for everyone?`)) {
                void api.removeDoc(docId).then(onRemoved);
              }
            }}
          >
            Delete
          </button>
        )}
      </header>
      <textarea
        className="doc-body"
        value={body}
        placeholder="Write — everyone in the space sees this page."
        onChange={(e) => {
          dirty.current = true;
          setBody(e.target.value);
        }}
      />
    </div>
  );
}
