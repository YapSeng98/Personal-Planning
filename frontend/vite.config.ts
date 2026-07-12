import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Dev proxy: the browser talks to the Vite origin, Vite forwards to ServiceNow.
// This sidesteps CORS entirely during development. For production hosting,
// configure CORS rules on the instance (see servicenow/README.md §7).
const SN_INSTANCE = 'https://dev405150.service-now.com'

export default defineConfig({
  // GitHub Pages serves the app at /Personal-Planning/ — set by the deploy
  // workflow. Local dev and other hosts stay at /.
  base: process.env.GH_PAGES ? '/Personal-Planning/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
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
