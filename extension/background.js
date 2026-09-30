// Relay between YouTube tabs and Planner tabs. Each YouTube tab reports its
// state here; we stamp it with the tab/window id and keep one entry per tab
// in storage.local under `tabs`. Planner tabs read that via storage.onChanged.

const KEY = 'tabs'

async function getTabs() {
  return (await chrome.storage.local.get(KEY))[KEY] ?? {}
}

// Serialise writes — reports from several tabs can arrive together.
let queue = Promise.resolve()
function edit(fn) {
  queue = queue.then(async () => {
    const tabs = await getTabs()
    fn(tabs)
    await chrome.storage.local.set({ [KEY]: tabs })
  }).catch(() => {})
  return queue
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'np-state' && sender.tab?.id != null) {
    const id = String(sender.tab.id)
    edit((tabs) => {
      if (msg.state) tabs[id] = { ...msg.state, tabId: sender.tab.id, windowId: sender.tab.windowId, at: Date.now() }
      else delete tabs[id]
    })
  } else if (msg?.type === 'np-focus' && typeof msg.tabId === 'number') {
    chrome.tabs.update(msg.tabId, { active: true }).catch(() => {})
    if (typeof msg.windowId === 'number') chrome.windows.update(msg.windowId, { focused: true }).catch(() => {})
  }
})

chrome.tabs.onRemoved.addListener((tabId) => edit((tabs) => { delete tabs[String(tabId)] }))

// Tab ids don't survive a browser restart — start clean.
const reset = () => chrome.storage.local.set({ [KEY]: {} })
chrome.runtime.onStartup.addListener(reset)
chrome.runtime.onInstalled.addListener(reset)
