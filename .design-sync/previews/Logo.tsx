import { Logo } from 'web';

export const Default = () => <Logo />;

export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    <Logo size={16} />
    <Logo size={22} />
    <Logo size={32} />
    <Logo size={48} />
  </div>
);

export const WithWordmark = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 600 }}>
    <Logo size={26} /> Lore
  </div>
);
