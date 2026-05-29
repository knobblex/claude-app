import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';

// Read BASIC_AUTH_* from project-root .env so the dev proxy can authenticate
// against server.py (which now always requires Basic Auth).
function readEnvFile(p: string): Record<string, string> {
  if (!fs.existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const i = t.indexOf('=');
    out[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return out;
}
const env = readEnvFile(path.resolve(__dirname, '..', '.env'));
const authHeader =
  env.BASIC_AUTH_USER && env.BASIC_AUTH_PASS
    ? 'Basic ' + Buffer.from(`${env.BASIC_AUTH_USER}:${env.BASIC_AUTH_PASS}`).toString('base64')
    : '';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Sub-apps live as siblings of web-app/ in hot_app/. Sub-app code may
      // import from @sub-apps/<id>/... — e.g. @sub-apps/app_radar/ui/Mobile.
      '@sub-apps': path.resolve(__dirname, '..'),
      // React lives in web-app/node_modules; sub-app source is outside the
      // project root so module resolution can't walk up to find it. Pin
      // these to absolute paths so anywhere in the workspace gets the same
      // copy (also prevents accidental React duplication).
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    // Vite's strict fs check blocks reading outside the project root by default;
    // sub-app source lives one level up, so allow that.
    fs: { allow: [path.resolve(__dirname, '..')] },
    proxy: {
      '/api': {
        target: 'http://localhost:5051',
        changeOrigin: true,
        configure: (proxy) => {
          if (!authHeader) return;
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Authorization', authHeader);
          });
        },
      },
    },
  },
});
