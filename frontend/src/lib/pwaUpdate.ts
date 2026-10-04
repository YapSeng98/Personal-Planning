// Getting new versions onto every device. An installed app (iPad/iPhone home
// screen) is often suspended and resumed rather than restarted, so a device
// could run an old version for days. The service worker takes over as soon
// as a new version is downloaded (it skips waiting — the same as versions
// before this file, so they pick it up too); this page keeps running the
// code it started with until it reloads. Here: look for an update whenever
// the app comes back to the foreground (and every 30 min); once one has
// taken over, reload the next time the app goes to the background — nothing
// is mid-edit then, and pages save on the way out — or as it comes back, if
// the system froze it before that reload ran. "Refresh" applies it at once.

let ready = false
const listeners = new Set<() => void>()

function markReady() {
  if (ready) return
  ready = true
  listeners.forEach((l) => l())
  if (document.visibilityState === 'hidden') applySoon()
}

/** Give pages' own on-hide saves (they write to IndexedDB on the same
    visibilitychange) time to finish before the reload. */
function applySoon() {
  window.setTimeout(() => { if (document.visibilityState === 'hidden') applyUpdate() }, 1500)
}

export function startUpdates() {
  if (!('serviceWorker' in navigator)) return
  const sw = navigator.serviceWorker
  // A new service worker asks open pages whether they update themselves
  // (public/sw-handoff.js) and reloads the ones that don't answer.
  sw.addEventListener('message', (e) => {
    if ((e.data as { type?: string } | null)?.type === 'planner:self-updating?') e.ports[0]?.postMessage(true)
  })
  sw.startMessages()
  // A new controller on a page that already had one = a new version took
  // over. (The very first install also takes control — no update then.)
  let controlled = !!sw.controller
  sw.addEventListener('controllerchange', () => {
    if (controlled) markReady()
    controlled = true
  })
  const base = import.meta.env.BASE_URL
  sw.register(`${base}sw.js`, { scope: base }).then((reg) => {
    const check = () => { if (navigator.onLine) reg.update().catch(() => {}) }
    window.setInterval(check, 30 * 60_000)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        if (ready) applySoon()
      } else if (ready) {
        // Back in the foreground with an update still pending: apply it
        // now, before anything new is typed.
        applyUpdate()
      } else {
        check()
      }
    })
  }).catch(() => {
    // no service worker (private mode, unsupported): the app still runs
  })
  // A part of the app loaded on demand (the PDF viewer…) is gone from the
  // server once a newer version is published — load that version instead
  // of failing. At most once a minute, so a real outage can't loop.
  window.addEventListener('vite:preloadError', (e) => {
    try {
      const last = Number(sessionStorage.getItem('planner_chunk_reload') || 0)
      if (Date.now() - last < 60_000) return
      sessionStorage.setItem('planner_chunk_reload', String(Date.now()))
    } catch {
      return
    }
    e.preventDefault()
    window.location.reload()
  })
}

export const updateReady = () => ready

export function onUpdateReady(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Switch to the downloaded version now (reloads the app). */
export function applyUpdate() {
  window.location.reload()
}

/** e.g. "4 Oct 2026, 14:32" — this build's time, in the device's locale. */
export function buildLabel(): string {
  const d = new Date(__APP_BUILD__)
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
