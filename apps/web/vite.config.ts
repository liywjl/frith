import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { uxlens } from './uxlens/vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  // UX Lens (dev server only): source stamping + capture endpoint.
  plugins: [uxlens(repoRoot), react()],
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
