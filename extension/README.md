# Planner Now Playing (Chrome extension)

Shows what's playing in your YouTube / YouTube Music tabs on the Planner's
Today hero. If no YouTube tab is playing (or the extension isn't installed —
phones, other browsers), the hero falls back to the video link from
Settings, exactly as before.

A web page can't see other tabs; this extension is the bridge:

- `youtube.js` — runs in youtube.com / music.youtube.com tabs; reads the
  Media Session metadata (title/artist/cover) + `<video>` play state and
  reports changes.
- `background.js` — keeps one entry per YouTube tab in `storage.local`,
  drops it when the tab closes; handles "switch to that tab".
- `planner.js` — runs on the Planner site; forwards the state to the page
  via `window.postMessage` (read by `frontend/src/lib/nowPlaying.ts`).

## Install (once per computer)

1. Open `chrome://extensions` (also works in Edge / Brave).
2. Turn on **Developer mode** (top right).
3. **Load unpacked** → pick this `extension/` folder.
4. Open the Planner, play something on YouTube Music in another tab.

After changing these files, hit the ↻ reload button on the extension card,
then reload any open YouTube tabs.
