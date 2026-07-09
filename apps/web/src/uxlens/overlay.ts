// UX Lens — dev-only capture overlay. Toggle with ⌥⇧U, click any element,
// draw on the screenshot, write a note; the item lands in ux-backlog/
// (via the uxlens vite middleware) ready for /ux-run to pick up.
//
// Loaded from main.tsx behind import.meta.env.DEV, so none of this (nor
// modern-screenshot) reaches the production bundle.
import { domToCanvas } from 'modern-screenshot';

type Tool = 'box' | 'arrow' | 'pen' | 'marker';

interface Point {
  x: number;
  y: number;
}

interface Op {
  tool: Tool;
  points: Point[];
}

const Z = 2147483000;
const RED = '#ff3b30';
const MARKER = 'rgba(255, 214, 0, 0.4)';

const CSS = `
.uxl-badge {
  position: fixed; left: 12px; bottom: 12px; z-index: ${Z};
  background: #12151b; color: #e8ecf2; border: 1px solid #ff3b30;
  border-radius: 999px; padding: 6px 14px; font: 12px/1.4 ui-sans-serif, system-ui;
  pointer-events: none; box-shadow: 0 4px 16px rgba(0,0,0,.4);
}
.uxl-outline {
  position: fixed; z-index: ${Z - 2}; pointer-events: none;
  border: 2px solid #ff3b30; border-radius: 3px;
  background: rgba(255, 59, 48, .08);
}
.uxl-chip {
  position: fixed; z-index: ${Z - 1}; pointer-events: none;
  background: #ff3b30; color: #fff; font: 11px/1 ui-monospace, monospace;
  padding: 4px 8px; border-radius: 4px; white-space: nowrap;
}
.uxl-scrim {
  position: fixed; inset: 0; z-index: ${Z + 1};
  background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center;
}
.uxl-panel {
  background: #171a20; color: #e8ecf2; border-radius: 12px; padding: 14px;
  max-width: min(1100px, 94vw); display: flex; flex-direction: column; gap: 10px;
  font: 13px/1.4 ui-sans-serif, system-ui; box-shadow: 0 12px 48px rgba(0,0,0,.6);
}
.uxl-canvas-wrap { overflow: auto; max-height: 62vh; border-radius: 8px; border: 1px solid #2a2f38; }
.uxl-canvas-wrap canvas { display: block; max-width: 100%; height: auto; cursor: crosshair; touch-action: none; }
.uxl-row { display: flex; align-items: center; gap: 8px; }
.uxl-panel button {
  background: #232833; color: #e8ecf2; border: 1px solid #343b47; border-radius: 6px;
  padding: 5px 12px; font: inherit; cursor: pointer;
}
.uxl-panel button:hover { background: #2c3340; }
.uxl-panel button[data-on='1'] { background: #ff3b30; border-color: #ff3b30; color: #fff; }
.uxl-panel textarea {
  background: #10131a; color: #e8ecf2; border: 1px solid #343b47; border-radius: 8px;
  padding: 8px 10px; font: inherit; min-height: 62px; resize: vertical; outline: none;
}
.uxl-panel textarea:focus { border-color: #ff3b30; }
.uxl-src { font: 11px ui-monospace, monospace; color: #8b93a1; margin-left: auto; }
.uxl-save { background: #ff3b30 !important; border-color: #ff3b30 !important; font-weight: 600; }
.uxl-spacer { flex: 1; }
.uxl-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: ${Z + 2};
  background: #12151b; color: #e8ecf2; border: 1px solid #2a9d5c; border-radius: 8px;
  padding: 8px 16px; font: 12px ui-sans-serif, system-ui; pointer-events: none;
  transition: opacity .4s; box-shadow: 0 4px 16px rgba(0,0,0,.4);
}
`;

let armed = false;
let annotating = false;
let logged = 0;
let badge: HTMLDivElement | null = null;
let outline: HTMLDivElement | null = null;
let chip: HTMLDivElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  node.setAttribute('data-uxl-ui', '1');
  return node;
}

function sourcesFor(target: Element): string[] {
  const out: string[] = [];
  let node: Element | null = target;
  while (node && out.length < 5) {
    const src = node.getAttribute('data-uxl');
    if (src && !out.includes(src)) out.push(src);
    node = node.parentElement;
  }
  return out;
}

function pickTarget(x: number, y: number): Element | null {
  const found = document.elementFromPoint(x, y);
  if (!found || found.closest('[data-uxl-ui]')) return null;
  return found;
}

function setArmed(on: boolean) {
  armed = on;
  outline?.remove();
  chip?.remove();
  badge?.remove();
  outline = chip = badge = null;
  document.documentElement.style.cursor = on ? 'crosshair' : '';
  if (on) {
    badge = el('div', 'uxl-badge', 'UX Lens — click what bugs you · esc to exit');
    outline = el('div', 'uxl-outline');
    chip = el('div', 'uxl-chip');
    document.body.append(badge, outline, chip);
  }
}

function onHover(e: MouseEvent) {
  if (!armed || annotating || !outline || !chip) return;
  const target = pickTarget(e.clientX, e.clientY);
  if (!target) {
    outline.style.display = chip.style.display = 'none';
    return;
  }
  const rect = target.getBoundingClientRect();
  Object.assign(outline.style, {
    display: 'block',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });
  const src = sourcesFor(target)[0];
  chip.textContent = src ?? target.tagName.toLowerCase();
  chip.style.display = 'block';
  chip.style.left = `${Math.min(rect.left, window.innerWidth - 340)}px`;
  chip.style.top = `${rect.top > 28 ? rect.top - 26 : rect.bottom + 6}px`;
}

function toast(text: string, ok = true) {
  const node = el('div', 'uxl-toast', text);
  if (!ok) node.style.borderColor = RED;
  document.body.append(node);
  setTimeout(() => (node.style.opacity = '0'), 1800);
  setTimeout(() => node.remove(), 2300);
}

// The SVG-as-image pass modern-screenshot rasterizes with can't resolve UA
// font aliases (-apple-system, ui-monospace, SF Mono…), so text falls back to
// wider generic faces and wraps where the live app doesn't. Pin real installed
// faces with near-identical metrics for the duration of the capture.
const CAPTURE_FONT_CSS = `
body { font-family: 'Helvetica Neue', Helvetica, 'Segoe UI', sans-serif; }
:root { --mono: Menlo, Consolas, monospace !important; }
`;

async function capture(target: Element) {
  annotating = true;
  // Hide lens chrome so it doesn't end up in the shot.
  if (outline) outline.style.display = 'none';
  if (chip) chip.style.display = 'none';
  if (badge) badge.style.display = 'none';

  const fontFix = document.createElement('style');
  fontFix.textContent = CAPTURE_FONT_CSS;
  document.head.append(fontFix);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  let shot: HTMLCanvasElement | null = null;
  try {
    shot = await domToCanvas(document.documentElement, {
      scale: Math.min(1, 1600 / window.innerWidth),
      filter: (node) => !(node instanceof Element && node.hasAttribute('data-uxl-ui')),
    });
  } catch (err) {
    console.warn('[uxlens] screenshot failed, logging note-only item', err);
  } finally {
    fontFix.remove();
  }
  if (badge) badge.style.display = '';
  openAnnotator(target, shot);
}

function openAnnotator(target: Element, shot: HTMLCanvasElement | null) {
  const rect = target.getBoundingClientRect();
  const sources = sourcesFor(target);
  const scale = shot ? shot.width / window.innerWidth : 1;

  const scrim = el('div', 'uxl-scrim');
  const panel = el('div', 'uxl-panel');
  scrim.append(panel);

  // --- canvas + drawing ---
  const ops: Op[] = [];
  let tool: Tool = 'box';
  let canvas: HTMLCanvasElement | null = null;

  if (shot) {
    canvas = el('canvas');
    canvas.width = shot.width;
    canvas.height = shot.height;
    const wrap = el('div', 'uxl-canvas-wrap');
    wrap.append(canvas);
    panel.append(wrap);

    // Pre-highlight the clicked element.
    ops.push({
      tool: 'box',
      points: [
        { x: rect.left * scale, y: rect.top * scale },
        { x: rect.right * scale, y: rect.bottom * scale },
      ],
    });

    const ctx = canvas.getContext('2d')!;
    const redraw = () => {
      ctx.drawImage(shot, 0, 0);
      for (const op of ops) drawOp(ctx, op, scale);
    };
    redraw();

    const toCanvasPoint = (e: PointerEvent): Point => {
      const box = canvas!.getBoundingClientRect();
      return {
        x: ((e.clientX - box.left) / box.width) * canvas!.width,
        y: ((e.clientY - box.top) / box.height) * canvas!.height,
      };
    };
    let drawing: Op | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      canvas!.setPointerCapture(e.pointerId);
      const p = toCanvasPoint(e);
      drawing = { tool, points: [p, p] };
      ops.push(drawing);
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = toCanvasPoint(e);
      if (drawing.tool === 'pen' || drawing.tool === 'marker') drawing.points.push(p);
      else drawing.points[1] = p;
      redraw();
    });
    canvas.addEventListener('pointerup', () => (drawing = null));

    const toolbar = el('div', 'uxl-row');
    const toolButtons = new Map<Tool, HTMLButtonElement>();
    for (const [t, label] of [
      ['box', 'Box'],
      ['arrow', 'Arrow'],
      ['pen', 'Pen'],
      ['marker', 'Marker'],
    ] as [Tool, string][]) {
      const btn = el('button', undefined, label);
      btn.dataset.on = t === tool ? '1' : '0';
      btn.onclick = () => {
        tool = t;
        for (const [key, b] of toolButtons) b.dataset.on = key === t ? '1' : '0';
      };
      toolButtons.set(t, btn);
      toolbar.append(btn);
    }
    const undo = el('button', undefined, 'Undo');
    undo.onclick = () => {
      if (ops.length > 1) ops.pop(); // keep the auto-highlight
      redraw();
    };
    toolbar.append(undo, el('span', 'uxl-src', sources[0] ?? 'no source'));
    panel.append(toolbar);
  } else {
    panel.append(el('div', 'uxl-row', `screenshot unavailable — ${sources[0] ?? 'no source'}`));
  }

  // --- note + size + actions ---
  const note = el('textarea');
  note.placeholder = 'What should change here?';
  panel.append(note);

  const bottom = el('div', 'uxl-row');
  bottom.append(el('span', undefined, 'size'));
  let size = 'S';
  const sizeButtons = new Map<string, HTMLButtonElement>();
  for (const s of ['S', 'M', 'L']) {
    const btn = el('button', undefined, s);
    btn.title = { S: 'cosmetic tweak', M: 'behavior / flow change', L: 'structural (modal→page…)' }[s]!;
    btn.dataset.on = s === size ? '1' : '0';
    btn.onclick = () => {
      size = s;
      for (const [key, b] of sizeButtons) b.dataset.on = key === s ? '1' : '0';
    };
    sizeButtons.set(s, btn);
    bottom.append(btn);
  }
  const cancel = el('button', undefined, 'Cancel');
  const save = el('button', 'uxl-save', 'Log it  ⌘⏎');
  bottom.append(el('span', 'uxl-spacer'), cancel, save);
  panel.append(bottom);

  const close = () => {
    scrim.remove();
    annotating = false;
  };
  cancel.onclick = close;

  const submit = async () => {
    if (!note.value.trim()) {
      note.focus();
      return;
    }
    save.disabled = true;
    save.textContent = 'Logging…';
    try {
      const res = await fetch('/__uxlens/item', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          note: note.value.trim(),
          size,
          route: location.pathname + location.search + location.hash,
          title: document.title,
          source: sources[0] ?? null,
          sources,
          element: {
            tag: target.tagName.toLowerCase(),
            id: target.id || undefined,
            cls: target.className && typeof target.className === 'string' ? target.className : undefined,
            text: target.textContent?.trim().slice(0, 80) || undefined,
            bbox: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            viewport: { w: window.innerWidth, h: window.innerHeight },
          },
          screenshot: canvas ? canvas.toDataURL('image/png') : null,
        }),
      });
      const { id } = (await res.json()) as { id: string };
      logged += 1;
      close();
      toast(`✓ ${id} logged (${logged} this session)`);
    } catch (err) {
      save.disabled = false;
      save.textContent = 'Log it  ⌘⏎';
      toast(`logging failed: ${String(err)}`, false);
    }
  };
  save.onclick = () => void submit();

  // Keep keystrokes (app hotkeys live on window) inside the modal.
  scrim.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit();
  });
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });

  document.body.append(scrim);
  note.focus();
}

function drawOp(ctx: CanvasRenderingContext2D, op: Op, scale: number) {
  const w = Math.max(2, 3 * scale);
  ctx.lineCap = ctx.lineJoin = 'round';
  if (op.tool === 'marker') {
    ctx.strokeStyle = MARKER;
    ctx.lineWidth = 14 * scale;
  } else {
    ctx.strokeStyle = RED;
    ctx.lineWidth = w;
  }
  const [a, b] = [op.points[0]!, op.points[op.points.length - 1]!];
  if (op.tool === 'box') {
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    return;
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  if (op.tool === 'arrow') {
    ctx.lineTo(b.x, b.y);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const head = 12 * scale;
    for (const side of [-1, 1]) {
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(
        b.x - head * Math.cos(angle + (side * Math.PI) / 7),
        b.y - head * Math.sin(angle + (side * Math.PI) / 7),
      );
    }
  } else {
    for (const p of op.points.slice(1)) ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function onArmedPointer(e: Event) {
  if (!armed || annotating) return;
  const me = e as MouseEvent;
  if ((me.target as Element | null)?.closest?.('[data-uxl-ui]')) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  if (e.type === 'click') {
    const target = pickTarget(me.clientX, me.clientY);
    if (target) void capture(target);
  }
}

export function installUxLens(): void {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyU') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!annotating) setArmed(!armed);
      } else if (e.key === 'Escape' && armed && !annotating) {
        setArmed(false);
      }
    },
    true,
  );
  window.addEventListener('mousemove', onHover, true);
  for (const type of ['pointerdown', 'pointerup', 'click']) {
    window.addEventListener(type, onArmedPointer, true);
  }
  console.info('[uxlens] ready — ⌥⇧U to arm');
}
