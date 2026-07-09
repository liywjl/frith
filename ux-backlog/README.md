# ux-backlog

The capture queue for UI/UX tweaks, fed by the **UX Lens** overlay
(`⌥⇧U` in any dev build of the web app — see `apps/web/src/uxlens/overlay.ts`)
and drained by the `/ux-run` Claude command.

## Files

- `items.jsonl` — one item per line, append-only at capture time.
- `shots/<id>.png` — annotated screenshot for each item (your drawings are
  baked into the PNG).

## Item schema

```json
{
  "id": "ux-mbz3k2-a4f",
  "ts": "2026-07-09T10:12:00.000Z",
  "status": "open",            // open → done | skipped (set by /ux-run)
  "size": "S",                 // S cosmetic · M behavior/flow · L structural (modal→page…)
  "note": "hover state too subtle",
  "route": "/",                // location at capture time
  "title": "Frith",
  "source": "apps/web/src/components/Sidebar.tsx:82",   // nearest JSX source
  "sources": ["...:82", "...:40"],                       // ancestor chain
  "element": { "tag": "button", "cls": "...", "text": "...", "bbox": {}, "viewport": {} },
  "shot": "ux-backlog/shots/ux-mbz3k2-a4f.png",
  "commit": "abc1234"          // added by /ux-run when done
}
```

## Lifecycle

1. Capture items while browsing (`pnpm dev:seeded:web`, then `⌥⇧U`).
2. Run `/ux-run` in Claude Code — it groups open items, implements them one
   commit apiece against the seeded instance, and verifies in the browser.
3. Resolved items are deleted from the queue (line + shot). The queue is
   local working state — `items.jsonl` and `shots/` are gitignored — so the
   record of what happened is the resolving commit itself, whose message
   carries the `[ux-…]` id. `skipped` items stay behind with a `reason`
   until you re-capture or clarify.
