import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateRawSync, crc32 } from 'node:zlib'

/** The browser extension (repo `extension/`) published as a zip next to the
    app, so any computer can download and install it (Settings → YouTube
    tabs on Today). Files sit at the zip's root: "Extract All" on Windows
    and double-click on a Mac both give a folder ready for Load unpacked. */
function extensionZip(): Plugin {
  return {
    name: 'extension-zip',
    generateBundle() {
      const dir = fileURLToPath(new URL('../extension', import.meta.url))
      const files = readdirSync(dir).filter((f) => !f.startsWith('.') && statSync(join(dir, f)).isFile()).sort()
      this.emitFile({ type: 'asset', fileName: 'planner-now-playing.zip', source: zip(files.map((f) => [f, readFileSync(join(dir, f))])) })
    },
  }
}

/** A minimal zip (deflate), dated 1980-01-01 so the same files give the same bytes. */
function zip(entries: [string, Buffer][]): Uint8Array {
  const parts: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  for (const [name, data] of entries) {
    const n = Buffer.from(name)
    const body = deflateRawSync(data)
    const crc = crc32(data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(8, 8)
    head.writeUInt16LE(0x21, 12); head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18)
    head.writeUInt32LE(data.length, 22); head.writeUInt16LE(n.length, 26)
    parts.push(head, n, body)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10)
    c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(body.length, 20)
    c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42)
    central.push(c, n)
    offset += head.length + n.length + body.length
  }
  const dirBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(dirBytes.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, dirBytes, end])
}

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
    extensionZip(),
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
        // .zip: the extension download must reach the file, not the app shell
        navigateFallbackDenylist: [/^\/api\//, /^\/oauth_token\.do/, /\.zip$/],
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
