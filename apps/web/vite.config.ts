import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        // LORE_API_PORT lets a second instance (scripts/dev-peer.sh) proxy
        // to its own server.
        target: `http://127.0.0.1:${process.env.LORE_API_PORT ?? 3001}`,
        ws: true,
      },
    },
  },
});
