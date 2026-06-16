import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API path prefixes handled by the Express backend. In dev, Vite proxies them
// to :4000 so the browser sees a single origin (no CORS, cookies just work).
const API_PREFIXES = ['/auth', '/contacts', '/lists', '/templates', '/campaigns', '/email', '/health'];

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API_PREFIXES.map((p) => [p, { target: 'http://localhost:4000', changeOrigin: true }]),
    ),
  },
});
