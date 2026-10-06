// Relay between YouTube tabs and Planner tabs. Each YouTube tab reports its
// state here; we stamp it with the tab/window id and keep one entry per tab
// in storage.local under `tabs`. Planner tabs read that via storage.onChanged.
//
// Which tab the Planner shows is picked in planner.js from two stamps kept
// here: `startedAt` — when the tab last started playing (a playlist moving
// on to its next song doesn't count, so an old tab can't pull the display
// back) — and `focusedAt` — when you last switched to that tab.

const KEY = 'tabs'
// A tab that stops and plays again within this long (a song ending and the
// next one starting, a quick pause) keeps its original start.
const SAME_RUN_MS = 5000

async function getTabs() {
  return (await chrome.storage.local.get(KEY))[KEY] ?? {}
}

// Serialise writes — reports from several tabs can arrive together. `fn`
// returns false when it changed nothing (then nothing is written).
let queue = Promise.resolve()
function edit(fn) {
  queue = queue.then(async () => {
    const tabs = await getTabs()
    if (fn(tabs) === false) return
    await chrome.storage.local.set({ [KEY]: tabs })
  }).catch(() => {})
  return queue
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'np-state' && sender.tab?.id != null) {
    const id = String(sender.tab.id)
    const now = Date.now()
    edit((tabs) => {
      if (!msg.state) {
        if (!tabs[id]) return false
        delete tabs[id]
        return
      }
      const prev = tabs[id]
      let startedAt = prev?.startedAt ?? 0
      if (msg.state.playing && !(prev && (prev.playing || now - prev.at < SAME_RUN_MS))) startedAt = now
      tabs[id] = {
        ...msg.state,
        tabId: sender.tab.id,
        windowId: sender.tab.windowId,
        at: now,
        startedAt,
        focusedAt: prev?.focusedAt ?? (sender.tab.active ? now : 0),
      }
    })
  } else if (msg?.type === 'np-focus' && typeof msg.tabId === 'number') {
    chrome.tabs.update(msg.tabId, { active: true }).catch(() => {})
    if (typeof msg.windowId === 'number') chrome.windows.update(msg.windowId, { focused: true }).catch(() => {})
  }
})

// Switching to a YouTube tab — or to the window it's showing in — makes it
// the one to show.
function focused(tabId) {
  edit((tabs) => {
    const t = tabs[String(tabId)]
    if (!t) return false
    t.focusedAt = Date.now()
  })
}
chrome.tabs.onActivated.addListener(({ tabId }) => focused(tabId))
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return
  chrome.tabs.query({ active: true, windowId }).then(([tab]) => { if (tab?.id != null) focused(tab.id) }).catch(() => {})
})

chrome.tabs.onRemoved.addListener((tabId) => edit((tabs) => {
  if (!tabs[String(tabId)]) return false
  delete tabs[String(tabId)]
}))

// Tab ids don't survive a browser restart — start clean.
const reset = () => chrome.storage.local.set({ [KEY]: {} })
chrome.runtime.onStartup.addListener(reset)

// Chrome only adds content scripts to pages loaded after the extension is
// installed or updated — a YouTube tab already playing (and an open
// Planner) stayed invisible until reloaded by hand. Reach them right away.
// (Any copy already in those tabs belongs to the previous install and has
// stopped working, so there's no double: it can't reach the extension.)
const YOUTUBE = ['https://www.youtube.com/*', 'https://music.youtube.com/*']
const PLANNER = ['https://yapseng98.github.io/Personal-Planning/*', 'http://localhost/*', 'http://localhost:*/*']
async function reachOpenTabs() {
  for (const [urls, file] of [[YOUTUBE, 'youtube.js'], [PLANNER, 'planner.js']]) {
    const tabs = await chrome.tabs.query({ url: urls }).catch(() => [])
    for (const tab of tabs) {
      if (tab.id == null || tab.discarded) continue
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] }).catch(() => {})
    }
  }
}
chrome.runtime.onInstalled.addListener(() => { reset().then(reachOpenTabs) })
