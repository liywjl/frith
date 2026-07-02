import { initials } from './format';

export function Avatar({ name, emoji }: { name: string; emoji?: string | null }) {
  return <div className={`avatar ${emoji ? 'emoji' : ''}`}>{emoji || initials(name)}</div>;
}
