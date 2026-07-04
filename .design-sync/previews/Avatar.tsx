import { Avatar } from 'web';

export const WithEmoji = () => <Avatar name="Mara Okonkwo" emoji="🦊" />;

export const Initials = () => <Avatar name="Devon Iyer" />;

export const Gallery = () => (
  <div style={{ display: 'flex', gap: 10 }}>
    <Avatar name="Mara Okonkwo" emoji="🦊" />
    <Avatar name="Priya Nair" emoji="🌿" />
    <Avatar name="Sam Rivera" />
    <Avatar name="Ola Berg" emoji="🛰️" />
  </div>
);
