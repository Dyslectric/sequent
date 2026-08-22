import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * Serve over HTTPS once `npm run cert` has produced a certificate.
 *
 * This is not decoration: a service worker only registers on a secure origin,
 * so over a plain `http://192.168.x.x` the app is reachable from a phone but
 * cannot be installed. With the matching CA trusted on the device, it can.
 */
function localHttps() {
  const key = new URL('./certs/server.key', import.meta.url);
  const cert = new URL('./certs/server.crt', import.meta.url);
  if (!existsSync(key) || !existsSync(cert)) return undefined;
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const https = localHttps();

export default defineConfig({
  // Relative base so a production build can be opened from any path.
  base: './',
  build: { target: 'es2022' },

  // Bind every interface so the sheet is reachable from another device on the
  // network — a phone, in practice. Vite listens on localhost only by default.
  server: { host: true, https },
  preview: { host: true, port: 4173, https },

  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by hand in main.js: the desktop build must not install a
      // service worker over its own bundled assets.
      injectRegister: null,
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'Sequent',
        short_name: 'Sequent',
        description: 'A math sheet that decides whether each line is true',
        // Relative, to match `base` — resolves against wherever it is served.
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        categories: ['education', 'productivity', 'utilities'],
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,webmanifest}'],
        // The Compute Engine and MathLive bundle is ~3.3 MB on its own, well
        // past Workbox's 2 MiB default. Precaching all of it is the point:
        // the sheet does no networking at runtime, so once cached it is fully
        // usable offline.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
