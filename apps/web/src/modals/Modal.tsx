import { useEffect, type ReactNode } from 'react';

/** Esc closes the surface. Capture + stopPropagation so the app-level key
 *  handler (thread panel, switcher) doesn't also act on the same press. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
}

/** Shared overlay + card shell for the app's dialogs. */
export function Modal({
  title,
  subtitle,
  headExtra,
  onClose,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Rendered before the title block, e.g. an avatar. */
  headExtra?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEscape(onClose);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          {headExtra}
          <div>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
          <button className="modal-x" onClick={onClose} aria-label="Close" title="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
