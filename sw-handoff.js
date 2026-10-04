// Loaded by the generated service worker (vite.config.ts → importScripts).
// Versions of the app from before lib/pwaUpdate.ts never reload into a new
// version while open — an iPad home-screen app can keep running one for
// days. When this service worker takes over, it asks each open page whether
// it updates itself; a page that doesn't answer is reloaded into the new
// version. Pages running pwaUpdate.ts answer at once and pick their own
// moment (never mid-edit).
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim()
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    await Promise.all(pages.map((page) => new Promise((resolve) => {
      // Don't wait for the reload itself: it's a request to this worker,
      // which isn't served until this activation is over.
      const timer = setTimeout(() => {
        Promise.resolve().then(() => page.navigate(page.url)).catch(() => {})
        resolve()
      }, 3000)
      try {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => { clearTimeout(timer); resolve() }
        page.postMessage({ type: 'planner:self-updating?' }, [channel.port2])
      } catch {
        // can't ask: leave it be
        clearTimeout(timer)
        resolve()
      }
    })))
  })())
})
