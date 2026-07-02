import type { ReactNode } from 'react';

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
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          {headExtra}
          <div>
            <div className="modal-title">{title}</div>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
