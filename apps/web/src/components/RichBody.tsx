const LINK_RE = /(https?:\/\/[^\s<>"']+)/g;

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
        return part;
      })}
    </>
  );
}
