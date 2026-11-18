import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // The .wasm and the worklets must stay separate files.
    assetsInlineLimit: 0,
  },
  plugins: [
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Tactus',
        short_name: 'Tactus',
        description: 'Metronome and chromatic tuner, built like a pedalboard. Works offline.',
        lang: 'en',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#141416',
        theme_color: '#0e0e10',
        categories: ['music', 'utilities'],
        // Not under /icons/: many Apache setups alias that path to their own stock
        // icons server-wide, which hides a site's folder of the same name (404).
        icons: [
          { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,webmanifest}', '**/archivo-latin-*.woff2'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
