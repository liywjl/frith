import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

// A Notion-style block editor over plain markdown. Every block is one
// contenteditable line (code blocks hold many); the document serializes to
// and parses from ordinary markdown, so a doc IS a .md file. Blocks come
// from typing markdown prefixes ("# ", "- ", "> ", "```", …) or the "/"
// menu; inline emphasis stays as visible markdown markers (Cmd+B/I/E wrap
// the selection) — honest plain text, no hidden state.

type BlockType = 'p' | 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'todo' | 'quote' | 'code' | 'divider';
interface Block {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean;
}

const newId = () => crypto.randomUUID();
const LIST_TYPES = new Set<BlockType>(['bullet', 'numbered', 'todo']);

function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.startsWith('```')) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) buf.push(lines[i++]!);
      blocks.push({ id: newId(), type: 'code', text: buf.join('\n') });
      continue;
    }
    if (!line.trim()) continue;
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      blocks.push({ id: newId(), type: `h${m[1]!.length}` as BlockType, text: m[2] ?? '' });
    } else if ((m = /^[-*]\s\[([ xX])\]\s?(.*)$/.exec(line))) {
      blocks.push({ id: newId(), type: 'todo', text: m[2] ?? '', checked: m[1] !== ' ' });
    } else if ((m = /^[-*]\s+(.*)$/.exec(line))) {
      blocks.push({ id: newId(), type: 'bullet', text: m[1] ?? '' });
    } else if ((m = /^\d+[.)]\s+(.*)$/.exec(line))) {
      blocks.push({ id: newId(), type: 'numbered', text: m[1] ?? '' });
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      blocks.push({ id: newId(), type: 'quote', text: m[1] ?? '' });
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ id: newId(), type: 'divider', text: '' });
    } else {
      blocks.push({ id: newId(), type: 'p', text: line });
    }
  }
  if (!blocks.length) blocks.push({ id: newId(), type: 'p', text: '' });
  return blocks;
}

function serializeBlocks(blocks: Block[]): string {
  const out: string[] = [];
  let num = 0;
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1];
    num = b.type === 'numbered' ? (prev?.type === 'numbered' ? num + 1 : 1) : 0;
    const line =
      b.type === 'h1' ? `# ${b.text}`
      : b.type === 'h2' ? `## ${b.text}`
      : b.type === 'h3' ? `### ${b.text}`
      : b.type === 'bullet' ? `- ${b.text}`
      : b.type === 'numbered' ? `${num}. ${b.text}`
      : b.type === 'todo' ? `- [${b.checked ? 'x' : ' '}] ${b.text}`
      : b.type === 'quote' ? `> ${b.text}`
      : b.type === 'divider' ? '---'
      : b.type === 'code' ? '```\n' + b.text + '\n```'
      : b.text;
    const sep = i === 0 ? '' : LIST_TYPES.has(b.type) && prev && prev.type === b.type ? '\n' : '\n\n';
    out.push(sep + line);
  });
  return out.join('');
}

// Markdown prefixes that convert a block as you type them (Notion behavior).
const MD_PREFIX: [RegExp, BlockType][] = [
  [/^###\s/, 'h3'],
  [/^##\s/, 'h2'],
  [/^#\s/, 'h1'],
  [/^[-*]\s\[\s?\]\s/, 'todo'],
  [/^[-*]\s/, 'bullet'],
  [/^\d+[.)]\s/, 'numbered'],
  [/^>\s/, 'quote'],
  [/^\[\]\s/, 'todo'],
];

const MENU: { type: BlockType; label: string; hint: string; kw: string }[] = [
  { type: 'p', label: 'Text', hint: 'Plain paragraph', kw: 'text paragraph plain' },
  { type: 'h1', label: 'Heading 1', hint: 'Big section heading', kw: 'heading h1 title' },
  { type: 'h2', label: 'Heading 2', hint: 'Medium heading', kw: 'heading h2' },
  { type: 'h3', label: 'Heading 3', hint: 'Small heading', kw: 'heading h3' },
  { type: 'bullet', label: 'Bulleted list', hint: '• One item per line', kw: 'bullet list unordered' },
  { type: 'numbered', label: 'Numbered list', hint: '1. 2. 3.', kw: 'numbered ordered list' },
  { type: 'todo', label: 'To-do list', hint: 'Checkboxes to tick off', kw: 'todo check task' },
  { type: 'quote', label: 'Quote', hint: 'Set apart a callout', kw: 'quote callout' },
  { type: 'code', label: 'Code', hint: 'Monospace block', kw: 'code snippet pre' },
  { type: 'divider', label: 'Divider', hint: 'A thin horizontal line', kw: 'divider rule hr line' },
];

const PLACEHOLDER: Partial<Record<BlockType, string>> = {
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  quote: 'Quote',
  code: '// code',
  bullet: 'List item',
  numbered: 'List item',
  todo: 'To-do',
};

/** Caret position as a plain-text offset inside el. */
function caretOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel?.rangeCount || !el.contains(sel.anchorNode)) return 0;
  const range = sel.getRangeAt(0).cloneRange();
  range.selectNodeContents(el);
  range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return range.toString().length;
}

function placeCaret(el: HTMLElement, offset: number) {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let remaining = Math.min(offset, el.textContent?.length ?? 0);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const len = node.textContent?.length ?? 0;
    if (remaining <= len) {
      range.setStart(node, remaining);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    remaining -= len;
  }
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

export function DocEditor({ initial, onChange }: { initial: string; onChange: (md: string) => void }) {
  const [blocks, setBlocks] = useState<Block[]>(() => parseMarkdown(initial));
  const refs = useRef(new Map<string, HTMLElement>());
  const focusReq = useRef<{ id: string; offset: number } | null>(null);
  const [menu, setMenu] = useState<{ blockId: string; query: string; index: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const apply = (next: Block[]) => {
    setBlocks(next);
    onChange(serializeBlocks(next));
  };

  // After a structural edit, rewrite the target block's DOM text (React never
  // renders contenteditable children) and put the caret where the edit left it.
  useEffect(() => {
    const req = focusReq.current;
    if (!req) return;
    focusReq.current = null;
    const el = refs.current.get(req.id);
    const b = blocks.find((x) => x.id === req.id);
    if (!el || !b) return;
    if ((el.textContent ?? '') !== b.text) el.textContent = b.text;
    placeCaret(el, req.offset);
  }, [blocks]);

  const focusBlock = (id: string, offset: number) => {
    focusReq.current = { id, offset };
  };

  const menuItems = menu
    ? MENU.filter((it) => it.kw.includes(menu.query.toLowerCase()) || it.label.toLowerCase().includes(menu.query.toLowerCase()))
    : [];

  // Turn b into a divider and put the caret in a fresh paragraph after it.
  const insertDivider = (b: Block) => {
    const i = blocks.findIndex((x) => x.id === b.id);
    const p = { id: newId(), type: 'p' as BlockType, text: '' };
    apply([...blocks.slice(0, i), { ...b, type: 'divider', text: '' }, p, ...blocks.slice(i + 1)]);
    focusBlock(p.id, 0);
  };

  const demoteToP = (b: Block) => {
    apply(blocks.map((x) => (x.id === b.id ? { ...x, type: 'p' as BlockType, checked: false } : x)));
    focusBlock(b.id, 0);
  };

  const pickMenuItem = (b: Block, type: BlockType) => {
    setMenu(null);
    if (type === 'divider') {
      insertDivider(b);
    } else {
      apply(blocks.map((x) => (x.id === b.id ? { ...x, type, text: '', checked: false } : x)));
      focusBlock(b.id, 0);
    }
  };

  const handleInput = (b: Block, el: HTMLElement) => {
    const text = el.textContent ?? '';

    // "/" menu: opened by typing "/" in an otherwise empty block; the rest of
    // the text is the filter query.
    if (menu?.blockId === b.id) {
      if (!text.startsWith('/')) setMenu(null);
      else setMenu({ ...menu, query: text.slice(1), index: 0 });
    } else if (text === '/' && b.type === 'p') {
      setMenu({ blockId: b.id, query: '', index: 0 });
    }

    // Markdown prefixes convert the block as soon as the trailing space lands.
    if (b.type !== 'code') {
      if (text === '```') {
        apply(blocks.map((x) => (x.id === b.id ? { ...x, type: 'code' as BlockType, text: '' } : x)));
        focusBlock(b.id, 0);
        return;
      }
      if (text === '---' && b.type === 'p') {
        insertDivider(b);
        return;
      }
      const convertible = b.type === 'p' || (b.type === 'bullet' && /^\[\]\s/.test(text));
      if (convertible) {
        for (const [re, type] of MD_PREFIX) {
          const m = re.exec(text);
          if (m && caretOffset(el) <= m[0].length) {
            apply(blocks.map((x) => (x.id === b.id ? { ...x, type, text: text.slice(m[0].length), checked: false } : x)));
            focusBlock(b.id, 0);
            return;
          }
        }
      }
    }

    apply(blocks.map((x) => (x.id === b.id ? { ...x, text } : x)));
  };

  const handleKeyDown = (b: Block, el: HTMLElement, e: React.KeyboardEvent) => {
    const i = blocks.findIndex((x) => x.id === b.id);
    const text = el.textContent ?? '';

    // While the "/" menu is open it owns the arrows and Enter.
    if (menu?.blockId === b.id && menuItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setMenu({ ...menu, index: (menu.index + delta + menuItems.length) % menuItems.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMenuItem(b, menuItems[menu.index]!.type);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }

    // Inline emphasis: wrap the selection in markdown markers.
    if ((e.metaKey || e.ctrlKey) && ['b', 'i', 'e'].includes(e.key.toLowerCase()) && b.type !== 'code') {
      e.preventDefault();
      const mark = e.key.toLowerCase() === 'b' ? '**' : e.key.toLowerCase() === 'i' ? '*' : '`';
      const sel = window.getSelection();
      if (!sel?.rangeCount) return;
      const end = caretOffset(el);
      const start = end - sel.toString().length;
      const next = text.slice(0, start) + mark + text.slice(start, end) + mark + text.slice(end);
      apply(blocks.map((x) => (x.id === b.id ? { ...x, text: next } : x)));
      focusBlock(b.id, start === end ? start + mark.length : end + mark.length * 2);
      return;
    }

    if (e.key === 'Enter') {
      if (b.type === 'code') {
        // Newlines stay inside the block; Enter on a trailing empty line exits.
        e.preventDefault();
        const at = caretOffset(el);
        if (at === text.length && text.endsWith('\n')) {
          const p = { id: newId(), type: 'p' as BlockType, text: '' };
          apply([...blocks.slice(0, i), { ...b, text: text.slice(0, -1) }, p, ...blocks.slice(i + 1)]);
          focusBlock(p.id, 0);
        } else {
          apply(blocks.map((x) => (x.id === b.id ? { ...x, text: text.slice(0, at) + '\n' + text.slice(at) } : x)));
          focusBlock(b.id, at + 1);
        }
        return;
      }
      e.preventDefault();
      // Empty list item: Enter exits the list (Notion behavior).
      if (LIST_TYPES.has(b.type) && !text) {
        demoteToP(b);
        return;
      }
      const at = caretOffset(el);
      const nextType: BlockType = LIST_TYPES.has(b.type) ? b.type : 'p';
      const fresh = { id: newId(), type: nextType, text: text.slice(at), checked: false };
      apply([...blocks.slice(0, i), { ...b, text: text.slice(0, at) }, fresh, ...blocks.slice(i + 1)]);
      focusBlock(fresh.id, 0);
      return;
    }

    if (e.key === 'Backspace' && caretOffset(el) === 0 && !window.getSelection()?.toString()) {
      // At the start of a block: first demote the type, then merge upward.
      if (b.type !== 'p') {
        e.preventDefault();
        demoteToP(b);
        return;
      }
      const prev = blocks[i - 1];
      if (!prev) return;
      e.preventDefault();
      if (prev.type === 'divider') {
        apply(blocks.filter((x) => x.id !== prev.id));
        focusBlock(b.id, 0);
        return;
      }
      apply(
        blocks
          .filter((x) => x.id !== b.id)
          .map((x) => (x.id === prev.id ? { ...x, text: prev.text + text } : x)),
      );
      focusBlock(prev.id, prev.text.length);
      return;
    }

    if (e.key === 'ArrowUp' && caretOffset(el) === 0) {
      const prev = [...blocks.slice(0, i)].reverse().find((x) => x.type !== 'divider');
      if (prev) {
        e.preventDefault();
        const pel = refs.current.get(prev.id);
        if (pel) placeCaret(pel, (pel.textContent ?? '').length);
      }
      return;
    }
    if (e.key === 'ArrowDown' && caretOffset(el) === text.length) {
      const next = blocks.slice(i + 1).find((x) => x.type !== 'divider');
      if (next) {
        e.preventDefault();
        const nel = refs.current.get(next.id);
        if (nel) placeCaret(nel, 0);
      }
      return;
    }
  };

  const handlePaste = (b: Block, el: HTMLElement, e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text/plain');
    if (!pasted.includes('\n') || b.type === 'code') return; // single line / code: browser default is fine
    e.preventDefault();
    const i = blocks.findIndex((x) => x.id === b.id);
    const at = caretOffset(el);
    const text = el.textContent ?? '';
    const parsed = parseMarkdown(pasted);
    const first = parsed[0]!; // parseMarkdown never returns an empty list
    const merged = { ...b, text: text.slice(0, at) + (first.type === 'p' ? first.text : ''), checked: b.checked };
    const middle = first.type === 'p' ? parsed.slice(1) : parsed;
    const tail = { id: newId(), type: 'p' as BlockType, text: text.slice(at) };
    const keepTail = tail.text.length > 0;
    apply([...blocks.slice(0, i), merged, ...middle, ...(keepTail ? [tail] : []), ...blocks.slice(i + 1)]);
    const last = keepTail ? tail : middle[middle.length - 1] ?? merged;
    focusBlock(last.id, keepTail ? 0 : last.text.length);
  };

  const anchorEl = menu ? refs.current.get(menu.blockId) : null;
  const containerBox = containerRef.current?.getBoundingClientRect();
  const anchorBox = anchorEl?.getBoundingClientRect();

  let num = 0;
  return (
    <div className="doc-editor" ref={containerRef}>
      {blocks.map((b, i) => {
        num = b.type === 'numbered' ? (blocks[i - 1]?.type === 'numbered' ? num + 1 : 1) : 0;
        if (b.type === 'divider') {
          return (
            <div key={b.id} className="doc-divider" role="separator">
              <hr />
            </div>
          );
        }
        const editable = (
          <div
            className={`doc-block ${b.type}`}
            contentEditable
            suppressContentEditableWarning
            spellCheck={b.type !== 'code'}
            data-ph={b.type === 'p' ? "Type '/' for commands" : PLACEHOLDER[b.type]}
            ref={(el) => {
              if (!el) {
                refs.current.delete(b.id);
                return;
              }
              refs.current.set(b.id, el);
              if (document.activeElement !== el && (el.textContent ?? '') !== b.text) el.textContent = b.text;
            }}
            onInput={(e) => handleInput(b, e.currentTarget)}
            onKeyDown={(e) => handleKeyDown(b, e.currentTarget, e)}
            onPaste={(e) => handlePaste(b, e.currentTarget, e)}
            onBlur={() => {
              if (menu?.blockId === b.id) setMenu(null);
            }}
          />
        );
        if (b.type === 'todo') {
          return (
            <div key={b.id} className={`doc-row todo ${b.checked ? 'done' : ''}`}>
              <button
                className="doc-check"
                aria-label={b.checked ? 'Mark not done' : 'Mark done'}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => apply(blocks.map((x) => (x.id === b.id ? { ...x, checked: !x.checked } : x)))}
              >
                {b.checked && <Icon name="check" />}
              </button>
              {editable}
            </div>
          );
        }
        if (b.type === 'bullet' || b.type === 'numbered') {
          return (
            <div key={b.id} className="doc-row">
              <span className="doc-marker">{b.type === 'bullet' ? '•' : `${num}.`}</span>
              {editable}
            </div>
          );
        }
        return (
          <div key={b.id} className="doc-row">
            {editable}
          </div>
        );
      })}
      {menu && anchorBox && containerBox && menuItems.length > 0 && (
        <div
          className="doc-menu"
          style={{ top: anchorBox.bottom - containerBox.top + 6, left: anchorBox.left - containerBox.left }}
        >
          {menuItems.map((it, idx) => (
            <button
              key={it.type}
              className={`doc-menu-item ${idx === menu.index ? 'active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setMenu({ ...menu, index: idx })}
              onClick={() => {
                const b = blocks.find((x) => x.id === menu.blockId);
                if (b) pickMenuItem(b, it.type);
              }}
            >
              <span className={`doc-menu-glyph ${it.type}`}>{glyphFor(it.type)}</span>
              <span className="doc-menu-text">
                {it.label}
                <small>{it.hint}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function glyphFor(type: BlockType): string {
  switch (type) {
    case 'h1': return 'H1';
    case 'h2': return 'H2';
    case 'h3': return 'H3';
    case 'bullet': return '•';
    case 'numbered': return '1.';
    case 'todo': return '☑';
    case 'quote': return '❝';
    case 'code': return '</>';
    case 'divider': return '—';
    default: return 'Aa';
  }
}
