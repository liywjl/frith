import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

// UX Lens (dev serve only): ⌥⇧U to capture UI gripes into ux-backlog/.
// It lives in a sibling repo wired in via link:, so it's absent on a fresh
// clone or in CI — import it dynamically and run without it when missing.
// captureCss pins real fonts during screenshots — the SVG rasterizer
// can't resolve UA aliases like -apple-system / ui-monospace.
const uxlensPlugin: PluginOption[] = [];
try {
  const specifier = 'uxlens/vite';
  const { uxlens } = await import(specifier);
  uxlensPlugin.push(
    uxlens({
      root: repoRoot,
      captureCss: `
        body { font-family: 'Helvetica Neue', Helvetica, 'Segoe UI', sans-serif; }
        :root { --mono: Menlo, Consolas, monospace !important; }
      `,
    }),
  );
} catch {
  // uxlens isn't linked — it's optional personal tooling, skip it
}

export default defineConfig({
  plugins: [...uxlensPlugin, react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // FRITH_API_PORT lets a second instance (scripts/dev-peer.mjs) proxy
        // to its own server.
        target: `http://127.0.0.1:${process.env.FRITH_API_PORT ?? 3001}`,
        ws: true,
      },
    },
  },
});
