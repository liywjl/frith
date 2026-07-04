// Bundle the Electron main (which includes the whole server) into dist/.
// The Pears modules stay external: they load native N-API prebuilds that
// must resolve from node_modules, not from inside a bundle.
import { cpSync, existsSync } from 'node:fs';
import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/main.js',
  external: ['electron', 'autobase', 'corestore', 'hyperswarm', 'blind-pairing'],
  banner: {
    // esbuild's ESM output loses Node's require; some bundled CJS deps need it.
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

cpSync('../server/seed/corpus.json', 'dist/corpus.json');
if (!existsSync('../web/dist')) {
  console.error('missing ../web/dist — run `pnpm --filter web build` first');
  process.exit(1);
}
cpSync('../web/dist', 'dist/web', { recursive: true });
console.log('desktop bundle ready in dist/');
