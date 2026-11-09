import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: Vite serves the client on http://localhost:3000 (the address registered with Battle.net and Discord for
// local sign-in) and passes the API and the OAuth callbacks to the web server.
const backend = process.env.VITE_BACKEND_URL || 'http://127.0.0.1:3260';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/api': backend,
      '/auth': backend,
    },
  },
});
