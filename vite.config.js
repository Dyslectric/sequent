import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * The dev and preview servers are plain HTTP.
 *
 * They used to serve HTTPS from a self-signed certificate, because a service
 * worker only registers on a secure origin and the point was installing the
 * sheet on a phone off the LAN. The app is served from a real origin now, so
 * that is where the PWA gets tested, and the certificate was costing more than
 * it bought: a browser that cannot click through a certificate warning — an
 * automated one driving the page — was refused before reaching the app at all.
 *
 * `npm run cert` still exists and nothing reads what it produces. Delete both
 * it and `certs/` if that stays true.
 */
export default defineConfig({
  // Relative base so a production build can be opened from any path.
  base: './',
  build: { target: 'es2022' },

  // Bind every interface so the sheet is reachable from another device on the
  // network — a phone, in practice. Vite listens on localhost only by default.
  server: { host: true },
  preview: { host: true, port: 4173 },

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
