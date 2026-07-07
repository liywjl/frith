// Bundle the Electron main (which includes the whole server) into dist/.
// The Pears modules stay external: they load native N-API prebuilds that
// must resolve from node_modules, not from inside a bundle.
import { cpSync, existsSync } from 'node:fs';
import esbuild from 'esbuild';

// --dev: bundle only the main process. The client comes from vite (HMR) and
// the window loads FRITH_DEV_URL, so no web dist or corpus is copied in.
const dev = process.argv.includes('--dev');

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/main.js',
  external: ['electron', 'autobase', 'corestore', 'hyperblobs', 'hyperswarm', 'blind-pairing', 'hypercore-crypto'],
  banner: {
    // esbuild's ESM output loses Node's require/__filename/__dirname; some
    // bundled CJS deps (pino, fastify plugins) still reference them.
    js: [
      "import { createRequire } from 'node:module';",
      "import { fileURLToPath as __fileURLToPath } from 'node:url';",
      "import { dirname as __pathDirname } from 'node:path';",
      'const require = createRequire(import.meta.url);',
      'const __filename = __fileURLToPath(import.meta.url);',
      'const __dirname = __pathDirname(__filename);',
    ].join(' '),
  },
});

if (!dev) {
  cpSync('../server/seed', 'dist/seed', { recursive: true });
  if (!existsSync('../web/dist')) {
    console.error('missing ../web/dist — run `pnpm --filter web build` first');
    process.exit(1);
  }
  cpSync('../web/dist', 'dist/web', { recursive: true });
}
console.log(`desktop ${dev ? 'dev ' : ''}bundle ready in dist/`);
