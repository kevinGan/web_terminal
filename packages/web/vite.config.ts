import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PORT = Number(process.env.WT_SERVER_PORT ?? 7681);
const target = `http://127.0.0.1:${SERVER_PORT}`;

// `@pierre/diffs` ships `dist/components/web-components.js` (registers the
// custom element used by PatchDiff) but doesn't list it in its `exports` map,
// so Node-style resolution would refuse it. Alias to the absolute path to
// bypass the exports check — relative imports inside that file resolve normally.
// Fail fast at config-load time if the file isn't where we expect (e.g. pnpm
// layout changed, or someone switched package managers): better than a silent
// runtime "custom element undefined" deep inside Pierre's render path.
const pierreWebComponents = resolve(
  __dirname,
  'node_modules/@pierre/diffs/dist/components/web-components.js'
);
if (!existsSync(pierreWebComponents)) {
  throw new Error(
    `@pierre/diffs web-components.js not found at ${pierreWebComponents}. ` +
    `pnpm hoisting / package layout likely changed. Update vite.config.ts alias.`
  );
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Web Terminal',
        short_name: 'Terminal',
        description: 'A web-based terminal that controls your local zsh, with multi-tab, split panes, file tree, and Claude Code shortcuts.',
        theme_color: '#1e1e2e',
        background_color: '#11111b',
        display: 'standalone',
        orientation: 'any',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
        ]
      },
      workbox: {
        // Cache the SPA shell + assets, but always go to network for /api and /ws.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/qr/],
        runtimeCaching: [
          {
            urlPattern: /^.*\/api\/.*/,
            handler: 'NetworkOnly'
          },
          {
            urlPattern: /^.*\/ws\/.*/,
            handler: 'NetworkOnly'
          }
        ],
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}']
      },
      devOptions: {
        enabled: false  // disable SW in dev to avoid stale builds
      }
    })
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: true },
      '/qr': { target, changeOrigin: true },
      '/ws': { target, ws: true, changeOrigin: true }
    }
  },
  resolve: {
    alias: {
      '@pierre/diffs/web-components': pierreWebComponents
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022'
  }
});
