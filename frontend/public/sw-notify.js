// Loaded by the generated service worker (vite.config.ts → importScripts).
// Reminder notifications: pushes from the server (supabase/functions/
// push-reminders) while the app is closed, and taps on any notification.

self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch {
    d = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const looking = pages.some((p) => p.focused && p.visibilityState === 'visible')
    // the app in front of you shows it as a banner too (same tag, shown once)
    for (const p of pages) p.postMessage({ type: 'planner:reminder', tag: d.tag, title: d.title, body: d.body })
    // always a notification: browsers stop pushes to sites that skip them
    await self.registration.showNotification(d.title || 'Planner', {
      body: d.body || '',
      tag: d.tag || undefined,
      silent: looking,
      data: { url: d.url || self.registration.scope },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope
  event.waitUntil((async () => {
    const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = pages.find((p) => p.url.startsWith(self.registration.scope))
    if (open) {
      await open.focus()
      return
    }
    await self.clients.openWindow(url)
  })())
})
