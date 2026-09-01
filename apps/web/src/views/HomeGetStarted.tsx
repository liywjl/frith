export function HomeGetStarted({ onNewChannel, onInvite }: { onNewChannel: () => void; onInvite: () => void }) {
  return (
    <section className="home-start">
      <div className="home-h">Get started</div>
      <div className="home-grid">
        <button className="home-card home-start-card" onClick={onNewChannel}>
          <b>Make your first channel</b>
          <span className="home-snippet">Something like #general — a place for the whole team.</span>
        </button>
        <button className="home-card home-start-card" onClick={onInvite}>
          <b>Invite someone</b>
          <span className="home-snippet">Share an invite code. Their copy of this space syncs straight from your machine.</span>
        </button>
      </div>
      <p className="home-start-note">This space lives on your device. Nothing leaves it until you invite someone.</p>
    </section>
  );
}
