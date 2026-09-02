import type { ReactNode } from 'react';
import { Logo } from '../components/Logo';
import { StartSpaceForm } from './StartSpaceForm';
import { JoinSpaceForm } from './JoinSpaceForm';
import { DeviceSpaces } from './DeviceSpaces';
import { DemoLink } from './DemoLink';

function reloadIntoSpace() {
  sessionStorage.removeItem('frith:view');
  window.location.reload();
}

export function SpacePage({
  placeholder = false,
  overlay = false,
  footer,
}: {
  placeholder?: boolean;
  overlay?: boolean;
  footer?: ReactNode;
}) {
  const page = (
    <div className="login">
      <aside className="login-side">
        <h1 className="login-brand">
          <Logo size={40} /> Frith
        </h1>
        <p>
          A space is a team, a crew, or a group of friends. It lives on its members' devices — nothing goes to a
          server — and you can be a different person in each one.
        </p>
        <StartSpaceForm placeholder={placeholder} onDone={reloadIntoSpace} />
        <div className="login-actions">
          <DemoLink onDone={reloadIntoSpace} />
          {footer}
        </div>
      </aside>
      <div className="login-content">
        <JoinSpaceForm onDone={reloadIntoSpace} />
        <DeviceSpaces />
      </div>
    </div>
  );
  if (!overlay) return page;
  return <div className="space-page-overlay">{page}</div>;
}
