import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev server forwards /api (and later /ws) to Django, so the browser only ever
// talks to one origin and no CORS setup is needed during development.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8001',
      '/ws': { target: 'ws://127.0.0.1:8001', ws: true },
    },
  },
});
