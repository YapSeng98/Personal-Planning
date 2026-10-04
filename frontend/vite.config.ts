import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Dev proxy: the browser talks to the Vite origin, Vite forwards to ServiceNow.
// This sidesteps CORS entirely during development. For production hosting,
// configure CORS rules on the instance (see servicenow/README.md §7).
const SN_INSTANCE = 'https://dev405150.service-now.com'

export default defineConfig({
  define: {
    __APP_BUILD__: JSON.stringify(new Date().toISOString()),
  },
  // GitHub Pages serves the app at /Personal-Planning/ — set by the deploy
  // workflow. Local dev and other hosts stay at /.
  base: process.env.GH_PAGES ? '/Personal-Planning/' : '/',
  plugins: [
    react(),
    VitePWA({
      // The service worker takes over as soon as a new version downloads
      // (skipWaiting/clientsClaim below — as before, so devices on older
      // versions pick it up on their next launch). lib/pwaUpdate.ts
      // registers it and decides when the page reloads into the new
      // version: on going to the background or coming back, never mid-edit.
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Personal Planning System',
        short_name: 'Planner',
        description: 'Vision → Year → Quarter → Month → Week → Day planning',
        theme_color: '#0B0D14',
        background_color: '#0B0D14',
        display: 'standalone',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // App shell is precached; API calls are network-first and the app
        // falls back to the Dexie store when offline (sync/engine.ts).
        // .mjs: the pdf.js worker (attachment viewer), so PDFs open offline.
        globPatterns: ['**/*.{js,mjs,css,html,svg,woff2}'],
        // set by vite-plugin-pwa itself only when it injects the register
        // script, which lib/pwaUpdate.ts replaces
        skipWaiting: true,
        clientsClaim: true,
        // reloads pages from versions that can't update themselves
        importScripts: ['sw-handoff.js'],
        navigateFallbackDenylist: [/^\/api\//, /^\/oauth_token\.do/],
      },
    }),
  ],
  server: {
    proxy: {
      '/api': { target: SN_INSTANCE, changeOrigin: true },
      '/oauth_token.do': { target: SN_INSTANCE, changeOrigin: true },
    },
  },
})
