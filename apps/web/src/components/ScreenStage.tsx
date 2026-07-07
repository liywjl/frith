import { useEffect, useRef } from 'react';
import type { ServerEvent } from '@app/shared';
import { sendClientEvent, useRealtime } from '../lib/useRealtime';
import { hueOf } from './Avatar';

/** How long a stroke lives: ink fades as it ages, laser-pointer style. */
const FADE_MS = 3500;
/** Batch pointer samples so a stroke is a few frames per second, not a flood. */
const SEND_EVERY_MS = 80;

type InkPoint = { x: number; y: number; t: number };
type Stroke = { color: string; pts: InkPoint[] };

/** Where the video content actually sits inside the element (object-fit:
 *  contain letterboxes it) — annotations anchor to the content, so every
 *  viewport's ink lands on the same pixel of the shared screen. */
function contentRect(video: HTMLVideoElement) {
  const cw = video.clientWidth;
  const ch = video.clientHeight;
  const vw = video.videoWidth || cw;
  const vh = video.videoHeight || ch;
  const scale = Math.min(cw / vw, ch / vh);
  const w = vw * scale;
  const h = vh * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
}

/**
 * The shared screen plus its ink layer. Anyone in the call draws to point at
 * things; strokes ride the websocket to the room and dissolve after a few
 * seconds — gestures, not records.
 */
export function ScreenStage({
  stream,
  channelId,
  meId,
  meName,
  presenterName,
}: {
  stream: MediaStream;
  channelId: string;
  meId: string;
  meName: string;
  presenterName: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef(new Map<string, Stroke>());
  const drawing = useRef<{ id: string; pending: [number, number][]; sentAt: number } | null>(null);
  const myColor = `hsl(${hueOf(meName)} 85% 55%)`;

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  useRealtime((event: ServerEvent) => {
    if (event.type !== 'call.draw' || event.channelId !== channelId || event.from === meId) return;
    const stroke = strokes.current.get(event.seg.id) ?? { color: event.seg.color, pts: [] };
    const t = performance.now();
    for (const [x, y] of event.seg.points) stroke.pts.push({ x, y, t });
    strokes.current.set(event.seg.id, stroke);
  });

  // The fade loop: redraw every frame with per-point age alpha, prune the dead.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
      }
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (strokes.current.size === 0) return;
      const rect = contentRect(video);
      const now = performance.now();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 3;
      for (const [id, stroke] of strokes.current) {
        stroke.pts = stroke.pts.filter((p) => now - p.t < FADE_MS);
        if (stroke.pts.length === 0) {
          strokes.current.delete(id);
          continue;
        }
        ctx.strokeStyle = stroke.color;
        for (let i = 1; i < stroke.pts.length; i++) {
          const a = stroke.pts[i - 1]!;
          const b = stroke.pts[i]!;
          ctx.globalAlpha = Math.max(0, 1 - (now - b.t) / FADE_MS);
          ctx.beginPath();
          ctx.moveTo(rect.x + a.x * rect.w, rect.y + a.y * rect.h);
          ctx.lineTo(rect.x + b.x * rect.w, rect.y + b.y * rect.h);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const normalize = (e: React.PointerEvent): [number, number] => {
    const box = canvasRef.current!.getBoundingClientRect();
    const rect = contentRect(videoRef.current!);
    const x = (e.clientX - box.left - rect.x) / rect.w;
    const y = (e.clientY - box.top - rect.y) / rect.h;
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };

  const flush = () => {
    const d = drawing.current;
    if (!d || d.pending.length === 0) return;
    sendClientEvent({ type: 'call.draw', channelId, seg: { id: d.id, color: myColor, points: d.pending } });
    d.pending = [];
    d.sentAt = performance.now();
  };

  const addPoint = (e: React.PointerEvent) => {
    const d = drawing.current;
    if (!d) return;
    const [x, y] = normalize(e);
    const stroke = strokes.current.get(d.id) ?? { color: myColor, pts: [] };
    stroke.pts.push({ x, y, t: performance.now() });
    strokes.current.set(d.id, stroke);
    d.pending.push([x, y]);
    if (d.pending.length >= 24 || performance.now() - d.sentAt > SEND_EVERY_MS) flush();
  };

  const endStroke = () => {
    flush();
    drawing.current = null;
  };

  return (
    <div className="screen-stage">
      <video ref={videoRef} autoPlay playsInline muted />
      <canvas
        ref={canvasRef}
        className="ink"
        onPointerDown={(e) => {
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // capture is a nicety; drawing works without it
          }
          drawing.current = { id: crypto.randomUUID(), pending: [], sentAt: 0 };
          addPoint(e);
        }}
        onPointerMove={addPoint}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />
      <span className="screen-stage-name">
        {presenterName === 'You' ? 'Your screen' : `${presenterName}’s screen`} — draw to point
      </span>
    </div>
  );
}
