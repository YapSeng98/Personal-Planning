// Runs in the Planner tab. Bridges storage → page via window.postMessage,
// since the page itself can't talk to the extension directly. Every message
// carries the extension's version, so the page also knows it's installed.

;(() => {
  const ORIGIN = location.origin
  const VERSION = chrome.runtime.getManifest().version

  // Which tab to show: a playing tab beats a paused one; among those, the
  // one you most recently started or switched to; then the latest report.
  function pick(tabs) {
    const list = Object.values(tabs || {})
    const chosen = (t) => Math.max(t.startedAt || 0, t.focusedAt || 0)
    list.sort((a, b) => (b.playing - a.playing) || (chosen(b) - chosen(a)) || (b.at - a.at))
    return list[0] ?? null
  }

  async function send() {
    try {
      const { tabs } = await chrome.storage.local.get('tabs')
      // `seen`: how many YouTube tabs are reporting (Settings uses it)
      window.postMessage({ type: 'planner-np', nowPlaying: pick(tabs), version: VERSION, seen: Object.keys(tabs || {}).length }, ORIGIN)
    } catch { /* extension reloaded — page keeps the last value */ }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.tabs) send()
  })

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== ORIGIN) return
    const d = e.data
    if (d?.type === 'planner-np-request') send()
    else if (d?.type === 'planner-np-focus') {
      try { chrome.runtime.sendMessage({ type: 'np-focus', tabId: d.tabId, windowId: d.windowId }) } catch {}
    }
  })

  // The page may not be listening yet (React still loading); it also sends
  // a request on mount, so either order works.
  send()
})()
