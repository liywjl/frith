// The local library: folders and git repos on THIS device, indexed so Ask
// can cite your code, docs, and commit history next to chat evidence. The
// registry and index never enter the space's log — indexing a folder is not
// sharing it. (Sharing an index into a space is a future, explicit act.)
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { LibrarySourceDto } from '@app/shared';

const execFileAsync = promisify(execFile);

interface Source {
  id: string;
  name: string;
  path: string;
  indexedAt: string | null;
}

interface LibraryDoc {
  sourceId: string;
  kind: 'file' | 'commit';
  /** Relative file path, or short commit sha. */
  ref: string;
  /** File name, or commit subject. */
  title: string;
  text: string;
  /** File mtime or commit date (ISO). */
  when: string;
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'release', 'coverage', '.next', 'vendor']);
const TEXT_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'md', 'mdx', 'txt', 'json', 'yaml', 'yml', 'toml',
  'css', 'scss', 'html', 'svg', 'py', 'go', 'rs', 'java', 'kt', 'rb', 'sh', 'sql', 'graphql',
  'proto', 'tf', 'ini', 'env.example', 'csv',
]);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_FILES_PER_SOURCE = 5_000;
const MAX_COMMITS = 500;

function indexableFile(name: string): boolean {
  const base = name.toLowerCase();
  if (base === 'license' || base === 'makefile' || base === 'dockerfile') return true;
  const ext = base.includes('.') ? base.split('.').pop()! : '';
  return TEXT_EXT.has(ext);
}

function walk(root: string, dir: string, out: { rel: string; mtime: Date }[]): void {
  if (out.length >= MAX_FILES_PER_SOURCE) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // unreadable dir — skip, don't fail the index
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES_PER_SOURCE) return;
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, full, out);
    else if (entry.isFile() && indexableFile(entry.name)) {
      try {
        const stat = fs.statSync(full);
        if (stat.size <= MAX_FILE_BYTES) out.push({ rel: path.relative(root, full), mtime: stat.mtime });
      } catch {
        // raced with a delete — skip
      }
    }
  }
}

async function gitCommits(root: string, sourceId: string): Promise<LibraryDoc[]> {
  if (!fs.existsSync(path.join(root, '.git'))) return [];
  try {
    const { stdout } = await execFileAsync(
      'git',
      // Record separator LEADS each record so the --name-only file list
      // (printed after the body) stays attached to its own commit.
      ['log', `-n${MAX_COMMITS}`, '--date=iso-strict', '--pretty=format:%x1e%h%x1f%an%x1f%ad%x1f%s%x1f%b', '--name-only'],
      { cwd: root, maxBuffer: 16 * 1024 * 1024 },
    );
    return stdout
      .split('\x1e')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        // rest = commit body + the --name-only file list, all searchable
        const [sha = '', author = '', date = '', subject = '', rest = ''] = chunk.split('\x1f');
        return {
          sourceId,
          kind: 'commit' as const,
          ref: sha,
          title: subject,
          text: `${subject}\n${author}\n${rest}`,
          when: date,
        };
      });
  } catch {
    return []; // no git binary, or not a repo after all
  }
}

class Library {
  private sources: Source[] = [];
  private docs: LibraryDoc[] = [];
  private loaded = false;

  private registryFile(): string {
    return path.join(process.env.LORE_DATA ?? '.lore-data', 'library.json');
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.sources = JSON.parse(fs.readFileSync(this.registryFile(), 'utf8')) as Source[];
    } catch {
      this.sources = [];
    }
    // Index lazily but eagerly enough: sources registered on a previous run
    // reindex in the background on first use.
    for (const source of this.sources) void this.index(source).catch(() => {});
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.registryFile()), { recursive: true });
    fs.writeFileSync(this.registryFile(), JSON.stringify(this.sources, null, 2));
  }

  private async index(source: Source): Promise<void> {
    const files: { rel: string; mtime: Date }[] = [];
    walk(source.path, source.path, files);
    const fileDocs: LibraryDoc[] = [];
    for (const f of files) {
      try {
        fileDocs.push({
          sourceId: source.id,
          kind: 'file',
          ref: f.rel,
          title: path.basename(f.rel),
          text: fs.readFileSync(path.join(source.path, f.rel), 'utf8'),
          when: f.mtime.toISOString(),
        });
      } catch {
        // unreadable/binary-despite-extension — skip
      }
    }
    const commitDocs = await gitCommits(source.path, source.id);
    this.docs = this.docs.filter((d) => d.sourceId !== source.id).concat(fileDocs, commitDocs);
    source.indexedAt = new Date().toISOString();
    this.persist();
  }

  list(): LibrarySourceDto[] {
    this.load();
    return this.sources.map((s) => ({
      id: s.id,
      name: s.name,
      path: s.path,
      fileCount: this.docs.filter((d) => d.sourceId === s.id && d.kind === 'file').length,
      commitCount: this.docs.filter((d) => d.sourceId === s.id && d.kind === 'commit').length,
      indexedAt: s.indexedAt,
    }));
  }

  async addSource(dir: string, name?: string): Promise<LibrarySourceDto> {
    this.load();
    const resolved = path.resolve(dir);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error('that path is not a folder on this device');
    }
    if (this.sources.some((s) => s.path === resolved)) throw new Error('that folder is already in the library');
    const source: Source = {
      id: crypto.randomUUID(),
      name: name?.trim() || path.basename(resolved),
      path: resolved,
      indexedAt: null,
    };
    this.sources.push(source);
    this.persist();
    await this.index(source);
    return this.list().find((s) => s.id === source.id)!;
  }

  removeSource(id: string): boolean {
    this.load();
    const before = this.sources.length;
    this.sources = this.sources.filter((s) => s.id !== id);
    if (this.sources.length === before) return false;
    this.docs = this.docs.filter((d) => d.sourceId !== id);
    this.persist();
    return true;
  }

  async reindexAll(): Promise<LibrarySourceDto[]> {
    this.load();
    for (const source of this.sources) await this.index(source);
    return this.list();
  }

  sourceName(id: string): string {
    return this.sources.find((s) => s.id === id)?.name ?? 'library';
  }

  allDocs(): LibraryDoc[] {
    this.load();
    return this.docs;
  }
}

export const library = new Library();
