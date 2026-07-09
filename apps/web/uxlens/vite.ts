// Dev-only vite plugin backing the UX Lens overlay (apps/web/src/uxlens).
//
// Two jobs:
//  1. transform (enforce: pre, before the React/oxc JSX compile): stamp every
//     host JSX element (div, button, …) with data-uxl="apps/web/src/Foo.tsx:123"
//     so the overlay can map a clicked DOM node back to the JSX that rendered
//     it. React 19 dropped fiber._debugSource, so the attribute is the channel.
//  2. middleware: receive captures from the overlay and append them to
//     ux-backlog/items.jsonl at the repo root (screenshots to ux-backlog/shots/),
//     the work queue for /ux-run.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { Plugin } from 'vite';

interface CaptureBody {
  note?: string;
  size?: string;
  route?: string;
  title?: string;
  source?: string | null;
  sources?: string[];
  element?: unknown;
  screenshot?: string | null;
}

const PNG_PREFIX = 'data:image/png;base64,';

function stampJsxSources(code: string, file: string, repoRoot: string): string | null {
  const rel = file.startsWith(repoRoot) ? file.slice(repoRoot.length).replace(/^\/+/, '') : file;
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inserts: { pos: number; text: string }[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName;
      // Host elements only — component tags render nothing themselves.
      if (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        inserts.push({ pos: tag.end, text: ` data-uxl="${rel}:${line}"` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (!inserts.length) return null;
  let out = code;
  for (const { pos, text } of inserts.sort((a, b) => b.pos - a.pos)) {
    out = out.slice(0, pos) + text + out.slice(pos);
  }
  return out;
}

export function uxlens(repoRoot: string): Plugin {
  const backlogDir = path.join(repoRoot, 'ux-backlog');
  const itemsFile = path.join(backlogDir, 'items.jsonl');
  return {
    name: 'uxlens',
    apply: 'serve',
    enforce: 'pre',

    transform(code, id) {
      const file = id.split('?')[0]!;
      if (!file.endsWith('.tsx') || file.includes('node_modules')) return null;
      const stamped = stampJsxSources(code, file, repoRoot);
      // Inline insertions add no newlines, so line numbers survive; only
      // column positions drift, which dev tooling tolerates.
      return stamped ? { code: stamped, map: null } : null;
    },

    configureServer(server) {
      server.middlewares.use('/__uxlens', (req, res, next) => {
        if (req.method === 'GET' && req.url === '/items') {
          const raw = fs.existsSync(itemsFile) ? fs.readFileSync(itemsFile, 'utf8') : '';
          const items = raw
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>);
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(items));
          return;
        }
        if (req.method === 'POST' && req.url === '/item') {
          const chunks: Buffer[] = [];
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', () => {
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as CaptureBody;
              const id = `ux-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`;
              fs.mkdirSync(path.join(backlogDir, 'shots'), { recursive: true });
              let shot: string | null = null;
              if (body.screenshot?.startsWith(PNG_PREFIX)) {
                shot = `ux-backlog/shots/${id}.png`;
                fs.writeFileSync(
                  path.join(repoRoot, shot),
                  Buffer.from(body.screenshot.slice(PNG_PREFIX.length), 'base64'),
                );
              }
              const item = {
                id,
                ts: new Date().toISOString(),
                status: 'open',
                size: body.size ?? 'S',
                note: body.note ?? '',
                route: body.route ?? '',
                title: body.title ?? '',
                source: body.source ?? null,
                sources: body.sources ?? [],
                element: body.element ?? null,
                shot,
              };
              fs.appendFileSync(itemsFile, JSON.stringify(item) + '\n');
              server.config.logger.info(`[uxlens] ${id} logged: ${item.note.slice(0, 70)}`);
              res.setHeader('content-type', 'application/json');
              res.end(JSON.stringify({ id }));
            } catch (err) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: String(err) }));
            }
          });
          return;
        }
        next();
      });
    },
  };
}
