import { Snippet } from 'web';

export const SearchHit = () => (
  <div style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 520 }}>
    <Snippet text="The [[auth]] refresh token rotates every 24h — see [[middleware/session.ts]] for the guard." />
  </div>
);

export const MultipleHits = () => (
  <div style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 520 }}>
    <Snippet text="We moved the [[P2P]] handshake into the [[Autobase]] writer so [[replication]] survives a cold peer." />
  </div>
);

export const NoHits = () => (
  <div style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 520 }}>
    <Snippet text="Plain result text with nothing highlighted." />
  </div>
);
