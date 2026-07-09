import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { uxlens } from 'uxlens/vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  plugins: [
    // UX Lens (dev serve only): ⌥⇧U to capture UI gripes into ux-backlog/.
    // captureCss pins real fonts during screenshots — the SVG rasterizer
    // can't resolve UA aliases like -apple-system / ui-monospace.
    uxlens({
      root: repoRoot,
      captureCss: `
        body { font-family: 'Helvetica Neue', Helvetica, 'Segoe UI', sans-serif; }
        :root { --mono: Menlo, Consolas, monospace !important; }
      `,
    }),
    react(),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // FRITH_API_PORT lets a second instance (scripts/dev-peer.sh) proxy
        // to its own server.
        target: `http://127.0.0.1:${process.env.FRITH_API_PORT ?? 3001}`,
        ws: true,
      },
    },
  },
});
