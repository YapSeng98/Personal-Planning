// Runs in the Planner tab. Bridges storage → page via window.postMessage,
// since the page itself can't talk to the extension directly.

;(() => {
  const ORIGIN = location.origin

  // Pick the one to show: a playing tab beats a paused one, then most recent.
  function pick(tabs) {
    const list = Object.values(tabs || {})
    list.sort((a, b) => (b.playing - a.playing) || (b.at - a.at))
    return list[0] ?? null
  }

  async function send() {
    try {
      const { tabs } = await chrome.storage.local.get('tabs')
      window.postMessage({ type: 'planner-np', nowPlaying: pick(tabs) }, ORIGIN)
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
