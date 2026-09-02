import { useState } from 'react';
import { api } from '../lib/api';

export function DemoLink({ onDone }: { onDone: () => void }) {
  const [pending, setPending] = useState(false);
  return (
    <button
      className="login-space-link"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void api.demoStart().then(onDone);
      }}
    >
      {pending ? 'Opening the demo space…' : 'Just looking? Explore the demo space →'}
    </button>
  );
}
