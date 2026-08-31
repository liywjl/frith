export function DemoBanner({ onReset }: { onReset: () => void }) {
  return (
    <div className="demo-banner">
      <span>You're exploring a demo space — everyone here is fictional. Poke around, post things, break nothing.</span>
      <span className="demo-banner-actions">
        <button onClick={onReset}>Start fresh with your own space</button>
        <a href="https://github.com/liywjl/frith/issues" target="_blank" rel="noreferrer">
          Suggest a feature
        </a>
      </span>
    </div>
  );
}
