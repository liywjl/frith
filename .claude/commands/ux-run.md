---
description: Drain the ux-backlog — implement, verify, and commit captured UI/UX items one by one
---

Process the UX Lens capture queue in `ux-backlog/items.jsonl`. Arguments (all optional): specific item ids, a max count (e.g. `5`), a size filter (`S`/`M`/`L`), or `--fanout` to parallelize small items across Haiku subagents.

## Setup

1. Read `ux-backlog/items.jsonl`; select items with `status: "open"` (respect any argument filters). If none, say so and stop.
2. Group items by area (shared `source` file or same panel/modal/component) and order groups so related changes land together. Present the plan briefly: id, note, size, target file.
3. Boot the seeded instance: `preview_start` `api-seeded`, then `web-seeded` (app at http://localhost:5374). Fresh deterministic data every boot.

## Per item

1. **Understand** — Read the annotated screenshot (`shot` path — the red boxes/arrows are the user's markup), the `note`, and the source at `source` (file:line). The `sources` array is the ancestor JSX chain if the primary anchor is too narrow. `route` + `element` locate it in the running app.
2. **Implement** — smallest diff that satisfies the note. Match surrounding style. For `L` items (structural: modal→page, flow changes) think before editing: read the surrounding wiring (App.tsx state, keyboard handlers) first.
3. **Verify in the browser** — reload the seeded app, navigate to where the item was captured, exercise the change (preview_click / preview_fill / preview_resize as needed), check `preview_console_logs` for errors, and take a `preview_screenshot` for visual changes. For keyboard-shortcut items, verify no clash with existing bindings (Cmd+K, Cmd+J, Alt+Arrows, ⌥⇧U is reserved for UX Lens).
4. **Gate** — `pnpm --filter web typecheck` (fast). Full `pnpm check` once at the end of the batch, not per item.
5. **Record** — resolved items are *deleted*, not archived: remove the item's line from `items.jsonl` and delete its `shots/` PNG (the queue is gitignored local state, so this needs no staging). The commit message carries the id as the durable record — plain sentence matching the repo log, e.g. `Sidebar hover state is visible now [ux-mbz3k2-a4f]`.
   - If an item is unclear or seems wrong after inspection, leave it in the queue with `status: "skipped"` and a `"reason"` field instead of guessing — report it at the end so the user can re-capture or clarify.

## `--fanout` mode (cheap-model batching)

For `S` items whose target files don't overlap: dispatch each to a Haiku subagent (Agent tool, `model: "haiku"`) with the note, screenshot path, source anchor, and instruction to make the minimal edit only — no commits. Run them in parallel. Then the main loop verifies each change in the seeded browser (step 3 above), fixes anything Haiku got wrong, and commits per item. Never skip the verification pass — cheap edits, full-strength review. `M`/`L` items always stay with the main model.

## Wrap up

- Run `pnpm check`. Fix anything it surfaces before finishing.
- Summarize: items done (id → commit), items skipped and why, anything noticed worth a future capture.
