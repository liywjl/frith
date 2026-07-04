import type { ReactNode } from 'react';

/** A clickable digest card headed by a channel name, used by Home and Task views. */
export function ThreadCard({
  channelName,
  corner,
  onClick,
  children,
}: {
  channelName: string;
  corner?: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button className="home-card" onClick={onClick}>
      <span className="home-card-top">
        <b># {channelName}</b>
        {corner}
      </span>
      {children}
    </button>
  );
}
