// Build the worklet in two stages:
//   1. esbuild: TypeScript (worklet + the server's space/domain layers) → one
//      ESM file, with Node builtins mapped to their Bare equivalents. The
//      Pears modules stay external — they load native N-API prebuilds that
//      bare-pack links into the app.
//   2. bare-pack --preset mobile: resolve those externals for every ios/
//      android host (native addons become linked: references for bare-link)
//      and emit the app.bundle.mjs the React Native side hands to
//      Worklet.start(). bare-pack doesn't follow pnpm's symlinks, so the
//      externals are first staged into a real node_modules with npm — the
//      same materialization trick the desktop build does for its packager.
// --smoke builds a bundle of the smoke scenario instead, runnable with the
// local `bare` runtime (pnpm smoke:bare) — same shims, real Bare.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import esbuild from 'esbuild';

const smoke = process.argv.includes('--smoke');
const root = path.resolve(import.meta.dirname, '..');

const NATIVE_EXTERNALS = [
  'autobase',
  'corestore',
  'hyperswarm',
  'blind-pairing',
  'hyperblobs',
  'hypercore-crypto',
  'b4a',
];
const BARE_EXTERNALS = ['bare-fs', 'bare-path', 'bare-process', 'bare-url'];

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [smoke ? 'worklet/smoke-bare.ts' : 'worklet/entry.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  outfile: smoke ? '.worklet/smoke.mjs' : '.worklet/backend.mjs',
  external: [...NATIVE_EXTERNALS, ...BARE_EXTERNALS],
  alias: {
    'node:crypto': './worklet/shims/crypto.ts',
    'node:fs': 'bare-fs',
    'node:path': 'bare-path',
    'node:process': 'bare-process',
    'node:url': 'bare-url',
  },
  banner: {
    // Bare has no `process` global; the server sources read process.env lazily.
    js: "import __process from 'bare-process'; if (!globalThis.process) globalThis.process = __process;",
  },
});
console.log(`worklet ${smoke ? 'smoke ' : ''}bundle ready in .worklet/`);

if (!smoke) {
  // Stage the externals with npm: bare-pack resolves module graphs with plain
  // directory walking (no pnpm-symlink awareness), so give it the flat, real
  // node_modules npm produces. Versions come from this package's manifest.
  const stage = path.join(root, '.worklet/stage');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(
    [...NATIVE_EXTERNALS, ...BARE_EXTERNALS].map((name) => [name, manifest.dependencies[name]]),
  );
  fs.mkdirSync(stage, { recursive: true });
  const previous = fs.existsSync(path.join(stage, 'package.json')) ? fs.readFileSync(path.join(stage, 'package.json'), 'utf8') : '';
  const next = JSON.stringify({ name: 'worklet-stage', private: true, dependencies }, null, 2);
  if (previous !== next || !fs.existsSync(path.join(stage, 'node_modules'))) {
    fs.writeFileSync(path.join(stage, 'package.json'), next);
    execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent'], { cwd: stage, stdio: 'inherit' });
  }
  fs.copyFileSync(path.join(root, '.worklet/backend.mjs'), path.join(stage, 'backend.mjs'));

  // bare-pack's exports map hides ./bin.js — resolve the package, then walk over.
  const packBin = path.join(path.dirname(createRequire(import.meta.url).resolve('bare-pack')), 'bin.js');
  execFileSync(
    process.execPath,
    [packBin, '--preset', 'mobile', '--out', path.join(root, 'worklet/app.bundle.mjs'), 'backend.mjs'],
    { cwd: stage, stdio: 'inherit' },
  );
  console.log('worklet/app.bundle.mjs ready — imported by src/lib/backend.ts');

  // The bundle references native addons as linked: — the app binary must embed
  // them. react-native-bare-kit's own link scripts (pod prepare_command /
  // gradle preBuild) walk the dependency graph from their package dir, which
  // under pnpm sees neither our worklet deps nor their transitive addons — so
  // link from the npm-staged closure instead, into the exact dirs its build
  // vendors (ios/addons, android/src/main/addons). Re-run after `pnpm install`
  // (a fresh store prunes them), then `pod install` to pick up new frameworks.
  const { default: link } = await import('bare-link');
  const barekit = fs.realpathSync(path.join(root, 'node_modules/react-native-bare-kit'));
  const targets = [
    { hosts: ['ios-arm64', 'ios-arm64-simulator', 'ios-x64-simulator'], out: path.join(barekit, 'ios/addons') },
    { hosts: ['android-arm64', 'android-arm', 'android-ia32', 'android-x64'], out: path.join(barekit, 'android/src/main/addons') },
  ];
  for (const { hosts, out } of targets) {
    for await (const resource of link(stage, { hosts, out })) {
      console.log('linked', path.relative(barekit, String(resource)));
    }
  }
  console.log('native addons linked into react-native-bare-kit — run pod install (ios) before the next build');
}
