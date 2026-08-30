const LINK_RE = /(https?:\/\/[^\s<>"']+|frith:\/\/[^\s<>"']+)/g;

function frithLabel(url: string) {
  try {
    const u = new URL(url);
    const app = u.host === 'open' || u.host === 'app' ? u.pathname.replace(/^\//, '') : u.host;
    return `↗ Open in ${app.replace(/^frith-/, 'Frith ')}`;
  } catch {
    return url;
  }
}

export function RichBody({ text }: { text: string }) {
  const parts = text.split(LINK_RE);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) => {
        if (/^https?:\/\//.test(part)) {
          return (
            <a key={i} href={part} target="_blank" rel="noreferrer">
              {part}
            </a>
          );
        }
        if (/^frith:\/\//.test(part)) {
          return (
            <a key={i} className="frith-link" href={part} title={part}>
              {frithLabel(part)}
            </a>
          );
        }
        return part;
      })}
    </>
  );
}
