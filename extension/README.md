# Planner Now Playing (Chrome extension)

Shows what's playing in your YouTube / YouTube Music tabs on the Planner's
Today hero, and follows the tab you're watching: the video you most
recently started, or the YouTube tab you switch to (a playlist in an older
tab moving on to its next song doesn't pull the display back). If a YouTube
tab starts playing while Today's own video plays, Today's video stops and
the display follows the tab. With no YouTube tab (or without the extension
— phones, other browsers), the hero uses the video link from Settings.

A web page can't see other tabs; this extension is the bridge:

- `youtube.js` — runs in youtube.com / music.youtube.com tabs; reads the
  Media Session metadata (title/artist/cover) + `<video>` play state and
  reports changes.
- `background.js` — keeps one entry per YouTube tab in `storage.local`
  (with when it started playing and when you last switched to it), drops it
  when the tab closes; handles "switch to that tab".
- `planner.js` — runs on the Planner site; picks the tab to show and
  forwards it (plus the extension version) to the page via
  `window.postMessage` (read by `frontend/src/lib/nowPlaying.ts`).

## Install (once per computer — Windows or Mac)

The app publishes this folder as a zip: **Settings → YouTube tabs on Today
→ Download extension** (it also says whether it's installed, and which
version). Then:

1. Unzip it (Windows: right-click → Extract All) and keep the folder.
2. Open `chrome://extensions` (Edge: `edge://extensions`, also Brave).
3. Turn on **Developer mode** (top right).
4. **Load unpacked** → pick the unzipped folder (or this `extension/`
   folder on the dev machine), then reload the Planner.

After changing these files: bump `version` in `manifest.json` and
`EXTENSION_VERSION` in `frontend/src/lib/nowPlaying.ts` (Settings offers the
update when they differ), hit ↻ on the extension card, then reload any open
YouTube tabs.
