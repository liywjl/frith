import { useEffect, useState } from 'react';
import type { AboutDto } from '@app/shared';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { Logo } from './Logo';

export function AboutButton() {
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const [about, setAbout] = useState<AboutDto | null>(null);

  useEffect(() => {
    api.about().then(setAbout).catch(console.error);
  }, []);

  const repo = about?.repoUrl ?? 'https://github.com/liywjl/frith';
  return (
    <>
      <button
        className="rail-about"
        title="About Frith"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAnchor({ left: r.right + 10, bottom: window.innerHeight - r.bottom });
        }}
      >
        <Logo size={18} />
      </button>
      {anchor && (
        <>
          <div className="status-pop-backdrop" onClick={() => setAnchor(null)} />
          <div className="status-pop about-pop" style={anchor}>
            <div className="about-head">
              <Logo size={28} />
              <b>Frith</b>
              <span className="about-version">{about ? `v${about.version}` : '…'}</span>
            </div>
            <div className="about-running">This is the version running on this device.</div>
            <p className="space-hint">Peer-to-peer team chat. Updates install themselves; you'll be asked to restart when one is ready.</p>
            <a className="about-link" href={repo} target="_blank" rel="noreferrer">
              <Icon name="github" /> Source on GitHub
            </a>
            <a className="about-link" href={`${repo}/issues/new`} target="_blank" rel="noreferrer">
              <Icon name="warning" /> Report an issue
            </a>
            <a className="about-link" href={`${repo}/issues/new`} target="_blank" rel="noreferrer">
              <Icon name="sparkle" /> Suggest a feature
            </a>
            <a className="about-link" href={`${repo}/releases`} target="_blank" rel="noreferrer">
              <Icon name="download" /> Release notes
            </a>
          </div>
        </>
      )}
    </>
  );
}
