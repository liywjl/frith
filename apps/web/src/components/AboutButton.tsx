import { useEffect, useState } from 'react';
import type { AboutDto } from '@app/shared';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { Logo } from './Logo';

export function AboutButton() {
  const [open, setOpen] = useState(false);
  const [about, setAbout] = useState<AboutDto | null>(null);

  useEffect(() => {
    api.about().then(setAbout).catch(console.error);
  }, []);

  const repo = about?.repoUrl ?? 'https://github.com/liywjl/frith';
  return (
    <>
      <button className="rail-about" title="About Frith" onClick={() => setOpen(true)}>
        <Logo size={18} />
      </button>
      {open && (
        <>
          <div className="status-pop-backdrop" onClick={() => setOpen(false)} />
          <div className="status-pop about-pop">
            <div className="about-head">
              <Logo size={28} />
              <div>
                <b>Frith</b>
                <div className="about-version">{about ? `v${about.version}` : ''}</div>
              </div>
            </div>
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
