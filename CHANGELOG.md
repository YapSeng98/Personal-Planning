# Changelog

Human-readable history of what changed in the Planner, newest first. Every
entry links to its commit on GitHub. Routine "deploy site" commits (just a
rebuild + publish, no code change) aren't listed here — see [commit
history](https://github.com/YapSeng98/Personal-Planning/commits/main) for
those.

## 2026-10-30

- **New look: Cosmic** — a futuristic deep-space design, from your
  references: a starry night sky with a planet's glowing rim on the horizon,
  neon cyan → violet → pink light on the glass panels, rings, progress bars
  and buttons, glowing titles and a new heading font (Sora). It's now the
  default on every device; Settings → Background → "Liquid" switches back.
  Cosmic is always dark. ([bab3031](https://github.com/YapSeng98/Personal-Planning/commit/bab3031))
- **Fix: a tap on the phone's tab bar sometimes did nothing** — after Back,
  the app put the page where you'd left it, and that shrank the tab bar as
  if you'd scrolled; your next tap only opened it again. Now only your own
  scrolling shrinks it. ([dde1317](https://github.com/YapSeng98/Personal-Planning/commit/dde1317))
- **Today on laptops: tidier header** — with a video set, the header now
  spans the full width with the video on the right (16:9); the greeting stays
  on one line with the % ring beside it, and the AI briefing reads across a
  comfortable width instead of a thin strip. On windows about 1000–1200px
  wide the tasks get the full width; habit names no longer break mid-word;
  dark mode has more colour behind the glass.
  ([c3235e9](https://github.com/YapSeng98/Personal-Planning/commit/c3235e9))
- **Liquid Glass on laptops, polished** — Today on a computer is now laid
  out like the preview you approved: the greeting and briefing, then your
  tasks, on the left; habits and the overview on the right — everything on
  one screen. The glass has the preview's soft sheen and light on every
  edge, and light gathers where your mouse is. The top line shows the date
  and time (no more "System online"), dark mode has a cleaner night
  wallpaper, and the installed app's window bar matches the theme.
  ([7ec3455](https://github.com/YapSeng98/Personal-Planning/commit/7ec3455))
- **New look: Liquid Glass** — the whole app now has the iPhone iOS 26
  "Liquid Glass" style you picked: see-through frosted glass panels with
  light on their edges, over a wallpaper in the Sunrise colours (coral,
  pink, gold, violet), in both light and dark.
  - phone: a floating glass tab bar; it shrinks to the page you're on while
    you scroll down — scroll up or tap it to open it again. The + and quick
    apps buttons are round glass
  - computer: a floating glass sidebar
  - cleaner type (bigger, bolder page titles), capsule buttons, round tick
    boxes, and Today's briefing card with a slowly turning colour edge
  - every feature works exactly as before — only the look changed. Prefer
    another wallpaper? Settings → Background (the new one is "Liquid")
  ([9f29981](https://github.com/YapSeng98/Personal-Planning/commit/9f29981))

## 2026-10-29

- **New look for the quick-apps menu** — tap the grid button on Today and
  your apps rise above it as a neat column of buttons, each with its name
  and coloured icon (the old round bubbles had no names on a phone and
  looked lopsided with fewer apps). The page dims behind; the button turns
  into × to close it, or tap anywhere outside. On a computer, hovering
  still opens it.
  ([77da20c](https://github.com/YapSeng98/Personal-Planning/commit/77da20c))
- **Choose which quick apps to show** — Settings → Quick apps → Apps to
  show: tick the ones you use; only those appear in the quick-apps menu and
  the pop-up window's "+". Untick them all to hide the button. Set per
  device. ([71b3a62](https://github.com/YapSeng98/Personal-Planning/commit/71b3a62))

- **Pop-up window: bigger, and resizable your way** — it opened too small
  for apps like Trading Hub:
  - on a computer it now opens roomy (wide, nearly the screen's height) and
    you can resize it from any edge or corner, not just one small grip; it
    remembers the size and place
  - on a phone, drag the handle at the top of the sheet: up for taller, down
    for shorter (remembered); all the way up is full screen, most of the way
    down tucks it away; from full screen, pull it down to get the sheet back
  - while an app loads, a thin bar at the top instead of a cover over it
  ([927a81d](https://github.com/YapSeng98/Personal-Planning/commit/927a81d))

- **Quick apps open in a pop-up window** — tapping Trading Hub, Daily
  Brief, Money Tracker or another quick app no longer leaves the Planner:
  - on a computer it opens in a small window you can drag by its top bar and
    resize from the corner (it remembers where), make full screen (button or
    double-click the bar), minimise to a pill at the bottom, or close
  - on a phone it slides up from the bottom, or goes full screen
  - several apps open as tabs and keep their place when you switch; "+" in
    the window opens another one; the window stays open as you move between
    Planner pages
  - offline, it says the app needs the internet and loads once you're back
  - prefer the old way? Settings → Quick apps → New tab (per device);
    Ctrl/⌘-click still opens a tab. "Open in Daily Brief" on a task opens in
    the window too
  ([bb3d21e](https://github.com/YapSeng98/Personal-Planning/commit/bb3d21e))

## 2026-10-27

- **Fix: repeats deleted before the fix still showed on Plan** — the first
  fix below read every deleted day as "skip this day", so a repeating task
  deleted with the old version kept repeating, and a doubled repeat kept
  both copies.
  - A deleted day now ends the repeat; only **Only this day** / **Skip this
    day** skip it. Repeats deleted with the old version stop by themselves
    on every device (and in the server's reminders once schema.sql is run).
  - Two copies of the same repeating task (same title, day and time)
    collapse to one even if the old version had already removed a copy.
  - A device checks in with the server before making a new day's repeats,
    so a repeat stopped on another device isn't made again.
  - Future copies on Plan show their time (on phones; on desktop in the sheet
    when you tap one), so a 09:00 and a 21:00 copy can be told apart.
  ([a3da1d4](https://github.com/YapSeng98/Personal-Planning/commit/a3da1d4))

- **Fix: a deleted repeating task kept coming back** — deleting a daily task
  only removed that day; the earlier days still repeated, so Plan kept
  showing it on every future day and the next day's copy was made again.
  - Delete on a repeating task now asks: **Only this day** (the repeat goes
    on) or **This and all after** (the repeat stops; earlier days stay).
  - Plan's faded future copies can be tapped: **Skip this day** or **Stop
    repeating** — use this to end a repeat deleted with the old version.
  - Turning Repeat off in the form stops it on every day.
  - Two copies of the same repeating task (same title, day and time) now
    collapse to one for good, rather than one copy being removed each day.
  - Reminders for repeating tasks follow the same rules (schema.sql — run
    it to update the server's reminder list).
  ([72d3283](https://github.com/YapSeng98/Personal-Planning/commit/72d3283))

## 2026-10-26

- **Phone fit pass** — every page, sheet and popup checked on iPhone SE,
  iPhone 15, a 360px Android and iPad mini, in English and Chinese, with
  long titles and six habits:
  - pages now open at their top (they opened where the previous page was
    scrolled — half-way down); Back returns to where you were
  - iPhone/iPad no longer zoom in when you tap a text box (steps, notes,
    times, reviews, sign-in…) — pinch-zoom still works
  - Today's cards: on phones the time sits under the title, so titles get the
    width; the details line wraps and a long project name ends in "…"
  - habits sit four to a row on phones (six in one row were too small to
    read or tap)
  - tick boxes are easier to hit with a finger; ▲ ▼ and the timer button are
    bigger on touch screens; no text under ~11px on phones
  ([5a5099b](https://github.com/YapSeng98/Personal-Planning/commit/5a5099b))

## 2026-10-24

- **Fix: another app's sign-in could switch the Planner's account** — the
  Planner and Daily Brief share one sign-in per browser, so signing in to
  Daily Brief as a different account switched the Planner too, and its
  changes then went into that account (while it said "Synced"). Now the
  Planner stops syncing and says the browser is on a different account;
  signing back in with your Planner account (username filled in) carries on,
  with nothing lost and nothing mixed.
  ([5a66b6c](https://github.com/YapSeng98/Personal-Planning/commit/5a66b6c))
- **Move a task to another priority with one tap** — in Today's "By
  priority" view every card has ▲ / ▼ to move it to the group above or
  below, so changing priority doesn't need a drag. On phones the drag
  handle is easier to press, and that view shows only a block's start
  time so the title keeps its room.
  ([64489c8](https://github.com/YapSeng98/Personal-Planning/commit/64489c8))
- **Daily Brief tasks in the Planner** — tasks taken in the Daily Brief app
  (Work Management System, same account) show a "📋 Brief" badge on Today
  and Board, and their form has an "Open in Daily Brief" link. Daily Brief
  is also a shortcut in Today's quick apps. Done, renamed or re-dated in the
  Planner, they update in Daily Brief too.
  ([64489c8](https://github.com/YapSeng98/Personal-Planning/commit/64489c8))
- **Arrange today's tasks by priority** — a "By priority" switch above
  Today's tasks (next to "My order"; each device remembers your choice)
  groups them under High, Medium and Low. Drag a task into another group to
  change its priority — the group lights up and a line shows where it will
  land — or within a group to reorder. The day's order then runs High →
  Medium → Low in "My order" too. An empty group shows as a slim "drag one
  here" row.
  ([daabd3c](https://github.com/YapSeng98/Personal-Planning/commit/daabd3c))
- **Trading Hub in quick apps** — Today's quick-apps menu (the ⋮⋮⋮ button
  above +) has a fifth shortcut, 📈 Trading Hub, opening the gold (XAU/USD)
  report. The shortcuts now sit on a slightly wider arc so all five fit on a
  phone without touching.
  ([98dd442](https://github.com/YapSeng98/Personal-Planning/commit/98dd442))

## 2026-10-23

- **Steps inside a task** — a checklist in the task form ("Add a step…"):
  tick, rename or remove steps, saved as you go; cards on Today and Board
  show "✓ 2/5" (green when all are done). Steps merge one by one across
  devices, so steps ticked on two devices — even one offline — both count.
  A repeating task's next day starts with its steps unticked.
  ([b00508d](https://github.com/YapSeng98/Personal-Planning/commit/b00508d))
- **Focus time in Stats** — the timer now records each session by day, so
  Stats shows focus time per day (last 14 days), per project (last 30
  days), and how your estimates compare with the time tasks really took.
  Two devices timing the same task both add up. Today's header counts time
  focused today.
  ([b00508d](https://github.com/YapSeng98/Personal-Planning/commit/b00508d))
- **Plan tomorrow** — at the bottom of Today (and as a "Wrap up the day" card
  from 5 pm): what's still open moves to tomorrow one by one or all at
  once (keeping its time), tomorrow's tasks can be added ("call bank 9am"),
  and one can be starred as tomorrow's most important task.
  ([b00508d](https://github.com/YapSeng98/Personal-Planning/commit/b00508d))
- **Reminders** — Settings → Reminders, per device: a reminder when a task's
  time block starts (or 5–30 min before), as a banner in the app with a
  "Start timer" button, or a system notification when the app is in the
  background. With the one-time server setup (`supabase/push_setup.sql` and
  the `push-reminders` Edge Function) they also arrive while the app is
  closed, by push.
  ([b00508d](https://github.com/YapSeng98/Personal-Planning/commit/b00508d))
- Steps, per-day focus sessions and closed-app reminders need
  `supabase/schema.sql` re-run; until then devices keep those changes and
  send them once it is.

## 2026-10-22

- **Overdue tasks show on Today** — an unfinished task from an earlier day
  used to disappear from Today once its day passed. Now open tasks from the
  last two weeks are listed at the top of Today's tasks, with a "Today"
  button on each and "Move all to today" (a moved task keeps its time of
  day). Older never-ticked tasks stay on their own day in Plan and Board, so
  years of old tasks can't bury today. The briefing mentions them too.
  ([0fd837e](https://github.com/YapSeng98/Personal-Planning/commit/0fd837e))
- **Focus timer** — tap ▶ on a task to time it. The running task shows at
  the top of every screen with a Stop button, keeps running if you close or
  reload the app, and stopping it (or ticking the task done, or starting
  another) adds the time to the task, synced to every device. Cards show
  time spent against the estimate ("⏱ 25m / 1h"), and Today's header shows
  "3/8 done · 1h 20m focused".
  ([0fd837e](https://github.com/YapSeng98/Personal-Planning/commit/0fd837e))
- **Fuller task form** — priority (High / Medium / Low, which colours the
  card), an estimate, notes (📝 on the card), and quick dates (Today /
  Tomorrow / Next week). Press **N** anywhere on a computer to add a task.
  "Next block" in the briefing now skips times already past.
  ([0fd837e](https://github.com/YapSeng98/Personal-Planning/commit/0fd837e))

## 2026-10-08

- **Pin a note to the top in Sketches** — every note card has a pin button
  on the corner of its paper (shown on hover on a computer, always on a
  phone or tablet), and there's a Pin button inside the note too. Pinned
  notes come first — in the main list and inside their folder — with the
  pin lit; the rest stay newest first. Pins sync to every device.
  Supabase side (re-run `schema.sql`): adds the `pinned` column.
  ([fea092b](https://github.com/YapSeng98/Personal-Planning/commit/fea092b))
- **The app can now be ahead of the database safely** — the app updates
  itself, but `schema.sql` is run by hand. Until it's run, a pin stays on
  the device where you made it (Settings → Sync says it's waiting for the
  database update) and goes out to the other devices by itself afterwards.
  Before, a change to a brand-new field was sent to a database that
  couldn't store it and quietly lost.
  ([fea092b](https://github.com/YapSeng98/Personal-Planning/commit/fea092b))

## 2026-10-07

- **Fixed: tasks made on one device could go missing on another for good**
  — when a device woke up (laptop lid opened, tablet unlocked) its sign-in
  had usually expired, and if the first refresh failed because the network
  wasn't back yet, the app kept syncing for up to a minute *without* the
  sign-in. The server answered those syncs "nothing new", and the device
  then skipped everything changed elsewhere in the meantime — while still
  showing "Synced". Syncs now always carry the sign-in; when it can't be
  refreshed the app shows "Offline" and tries again within seconds. Every
  device downloads everything once after this update, so anything it
  skipped arrives. Supabase side (re-run `schema.sql`): sync requests
  without a sign-in are refused instead of answered.
  ([99b8c0b](https://github.com/YapSeng98/Personal-Planning/commit/99b8c0b))
- **A signed-out device says so instead of quietly running "Local only"** —
  if a device's sign-in ends, a banner says so at once (changes are kept on
  the device), and the next launch asks you to sign in again with your
  username filled in; everything made meanwhile then syncs. Before, a device
  that had ever tried the offline demo silently stopped syncing. Brief
  network drops now show as "Offline" rather than "Sync error".
  ([99b8c0b](https://github.com/YapSeng98/Personal-Planning/commit/99b8c0b))

## 2026-10-06

- **Extension 1.3: works on tabs that were already open** — installing or
  updating "Planner Now Playing" used to need a manual reload of the open
  YouTube tab and the Planner before Today would follow the video; it now
  reaches them by itself. Settings → YouTube tabs on Today also says how
  many YouTube tabs it's following, or what to do if it sees none.
  ([757018e](https://github.com/YapSeng98/Personal-Planning/commit/757018e))
- **Today's display follows YouTube in more situations** (extension 1.2):
  YouTube's own mini player (keeps playing while you browse YouTube), a
  video popped out into its own picture-in-picture window, and players
  without a normal video (like YouTube Music's bar) now show on Today too —
  before, the display stayed on the Settings video. Update the extension
  from Settings → YouTube tabs on Today.
  ([ad25fa8](https://github.com/YapSeng98/Personal-Planning/commit/ad25fa8))
- **Fixed: a picture attached to a review was blank after a refresh** — when
  the app started, it moved any picture over 300 KB (an ordinary screenshot
  or photo) out of the review into file storage, but the review page only
  knew how to show pictures kept inside the review. Review pictures now
  show wherever they're kept (downloaded once, then kept on the device),
  so ones already moved show again; and pictures now stay inside the review
  unless it's too big to sync.
  ([68b7e9b](https://github.com/YapSeng98/Personal-Planning/commit/68b7e9b))
- **Review page: a mood calendar instead of the past-reviews list** — "Your
  reflections" shows a month at a glance, in one compact card however many
  reviews you have: each day's mood face (tinted by its energy), today
  ringed, a 🔥 streak and "4 of 6 days reviewed". Tap a day to open its
  review — or a missed day to write it; W buttons open weekly reviews and
  badges the monthly and yearly ones; ‹ › to browse months.
  ([39e6747](https://github.com/YapSeng98/Personal-Planning/commit/39e6747))

## 2026-10-05

- **New look for Sketches folders** — each folder is now a tile that looks
  like a real folder, in its own colour, with your newest notes peeking out
  like sheets of paper (they fan out when you hover), or the folder's cover
  image if it has one; the name and "3 notes · 1 folder" sit underneath.
  Rename and delete appear on hover; on phones folders sit two to a row
  with one edit button, and Delete is in the folder's edit sheet.
  ([f98f074](https://github.com/YapSeng98/Personal-Planning/commit/f98f074))
- **Today's video follows your YouTube tabs — on any computer** — the
  "Planner Now Playing" browser extension can now be downloaded from
  Settings → YouTube tabs on Today, which also says whether it's installed
  and walks through the 4 install steps (Windows or Mac, Chrome or Edge).
  The display now follows the tab you're watching: the video you most
  recently started, or the YouTube tab you switch to — an older tab moving
  on to its next song no longer pulls it back. When a YouTube tab starts
  playing, or you press ↗ to open Today's video in YouTube, Today's own copy
  stops instead of both playing at once.
  ([1f9b654](https://github.com/YapSeng98/Personal-Planning/commit/1f9b654))
- **Fixed: "This file isn't available yet" for an attachment added on
  another device** — a note could reach your other devices before its file
  had finished uploading (e.g. the iPad was put away mid-upload), leaving a
  file nobody could open. Now a file only shows up on other devices once
  it's actually uploaded; the rest of the note still syncs straight away.
  Big files (over 6 MB) upload in pieces and carry on where they stopped
  after an interruption instead of starting over, and uploads no longer
  hold up other syncing. The device that added a file shows "Uploading 40%"
  / "Not uploaded yet" on it (Settings shows it too); a file still on its
  way opens by itself once it arrives. Also fixed: a change saved by the
  previous app version while offline lost its new attachments once the app
  updated.
  ([b0c793d](https://github.com/YapSeng98/Personal-Planning/commit/b0c793d))

## 2026-10-04

- **Fixed: a change made on one device could be undone by another** — e.g.
  a file attached on the laptop vanished because the iPad, with the same
  review open, saved its older copy over it. Every save now sends only what
  was actually changed on that device, and the server merges field by field:
  different fields edited on different devices are all kept, files attached
  on two devices are all kept, and when the same field was edited in two
  places the most recent edit wins, whatever order the devices sync in. Open
  reviews and notes take in other devices' changes as they arrive instead of
  overwriting them. Rarer timing gaps fixed along the way: a save still in
  progress while another device synced could be skipped by that device for
  good; a fresh edit could be overwritten by a download arriving at the same
  moment; two devices starting the same day's review or habit tick at the
  same instant now merge into one; two accounts writing a review for the same
  day no longer clash. Needs `supabase/schema.sql` re-run.
  ([d9e73ab](https://github.com/YapSeng98/Personal-Planning/commit/d9e73ab))
- **New versions reach every device on their own** — a home-screen app on
  iPad/iPhone could keep running an old version for days. The app now checks
  for updates whenever you come back to it and switches to the new version
  when you leave it or return (never while you're typing); a "new version
  ready" bar offers it right away. Devices on an older version switch on
  their first launch after a release. Settings → Version shows which version
  a device runs.
  ([fa42b57](https://github.com/YapSeng98/Personal-Planning/commit/fa42b57))
- **Fixed: logging out on one device signed you out everywhere** — your
  other devices silently stopped syncing. Log out now only affects the device
  you're on. A device also remembers whose data it holds: if a different
  account signs in, the old data is cleared first instead of being shown or
  uploaded to the wrong account.
  ([2709207](https://github.com/YapSeng98/Personal-Planning/commit/2709207))
- **Fixed: the AI address could leak between accounts** — after logging out,
  another account signing in on the same device got the first account's AI
  address saved to it. Log out now clears it, and it's only ever saved to the
  account it belongs to.
  ([9ed2c6f](https://github.com/YapSeng98/Personal-Planning/commit/9ed2c6f))
- **Repeating tasks on several devices** — tomorrow's copy of a repeating task
  is now identical on every device, so two devices can't create duplicates;
  "Doesn't repeat" now ends the series instead of it coming back the next day.
  ([9d61f32](https://github.com/YapSeng98/Personal-Planning/commit/9d61f32))
- **Layout pass on 5 devices** (iPhone SE, iPhone 15, Galaxy S24, iPad,
  desktop — 28 screens each): fixed the Review page sliding sideways on small
  phones, the + button covering the last item on a page, a ragged note
  toolbar and draw-pad bar on phones, a cut-off note title and cramped folder
  header on iPad, and too-narrow folder cards on desktop.
  ([e15ad04](https://github.com/YapSeng98/Personal-Planning/commit/e15ad04))
- **Fixed: photo-heavy notes still "too large to sync"** — notes with many
  photos now shrink step by step until they fit (a 23.7 MB, 11-photo test
  note synced at 5.0 MB with every photo kept). The note toolbar also fits
  on phones now instead of being cut off at the edge.
  ([0d5c0e7](https://github.com/YapSeng98/Personal-Planning/commit/0d5c0e7))
- **Undo / Redo** — typed notes get ↶ ↷ buttons (and ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z)
  that also cover inserted drawings, image resizes and removed images; drawing
  notes and the drawing pad get Redo next to Undo.
  ([4505e4c](https://github.com/YapSeng98/Personal-Planning/commit/4505e4c))
- **Smoother notes & faster sync** — typed notes save as you type (about a
  second after you pause) and when you switch apps; drawing notes no longer
  stutter by saving after every stroke. A note left open on another device
  can't overwrite newer edits any more, and picks them up live. Changes reach
  your other devices in about 2 seconds. Tap an image or drawing in a note to
  resize it (S / M / L / Full) or remove it; drawings now insert at the size
  you drew them instead of 2–3× too big.
  ([340cb4d](https://github.com/YapSeng98/Personal-Planning/commit/340cb4d))
- **Draw inside a typed note** — a ✏️ button in the note toolbar opens a
  drawing pad; "Insert drawing" drops your sketch or handwriting into the
  note where your cursor is (cropped to what you drew). Type and draw in the
  same note. Works with Apple Pencil (palm rejection).
  ([f33f4c3](https://github.com/YapSeng98/Personal-Planning/commit/f33f4c3))
- **Fixed: edits lost when saved in quick succession** — a second save made
  while the first was still uploading was rejected by the server (e.g. a
  note's text and attachments vanished after its title synced). **Faster
  sync**: changes now reach your other devices within a second or two (was
  up to a minute), and an open note picks up another device's changes.
  Needs `supabase/schema.sql` re-run.
  ([7e21870](https://github.com/YapSeng98/Personal-Planning/commit/7e21870))
- **Fixed: attachments not opening on iPhone** — Safari refused to keep the
  downloaded file, which stopped the viewer (and attaching from the phone).
  Tested with Safari's engine: a 30 MB PDF opens, reopens instantly from the
  phone, and files attached on the phone open on the computer.
  ([8b75506](https://github.com/YapSeng98/Personal-Planning/commit/8b75506))
- **Fixed: big old notes stuck with "too large to sync"** — notes and reviews
  saved before files moved to Storage now slim themselves automatically:
  attached files move to Storage, oversized images shrink. A 93 MB test note
  went to 0.65 MB and synced, with its PDF still opening on another device.
  ([74b96b0](https://github.com/YapSeng98/Personal-Planning/commit/74b96b0))
- **Read attachments without downloading** — tap an attachment to open it in
  the app: PDFs (every page, scrollable — works on iPhone too), images,
  video, audio and text files. A Download button is there if you want the
  file. Word/Excel can't be shown in a browser, so those offer the download.
  ([1693525](https://github.com/YapSeng98/Personal-Planning/commit/1693525))

## 2026-10-03

- **Attachments up to 50 MB** — PDFs, spreadsheets, videos and other files on
  reviews and Sketches notes are now kept in Supabase Storage instead of
  inside the record (was 5 MB). The chip shows the size; tap to download.
  Files added offline upload on the next sync, other devices download on
  first open. Removing an attachment deletes the file too. Images still
  shrink and show inline.
  ([15d6e04](https://github.com/YapSeng98/Personal-Planning/commit/15d6e04))
- **Paste or drop files on a note** — on a typed Sketches note, paste a file
  anywhere on the page (Ctrl/⌘+V) or drag files onto it. Images go into the
  note; other files (PDF, Excel, …) become attachments. 📎 now takes several
  files at once. Also fixed: reloading a just-created note showed it empty.
  ([07fd739](https://github.com/YapSeng98/Personal-Planning/commit/07fd739))
- **Fixed: note title hidden on phones** when the note sat in a nested folder
  with a long path — the title now has its own row, and the folder picker
  shortens long paths with "…".
  ([a994316](https://github.com/YapSeng98/Personal-Planning/commit/a994316))
- **Folders inside folders** in Sketches — open a folder and tap Folder to
  make a sub-folder. A path line (Sketches › Personal Work › …) jumps to any
  level, the back arrow goes up one, and a folder's edit sheet has an
  "Inside" picker to move it. Deleting a folder moves what's in it up a
  level; nothing is deleted. Syncs once `supabase/schema.sql` is re-run.
  ([a2220f5](https://github.com/YapSeng98/Personal-Planning/commit/a2220f5))
- **Folder covers can be resized** — drag the banner's bottom edge to make it
  taller or shorter, or tap "Show full image" to see the whole picture
  ("Default size" goes back). Keeps the same shape on phone and desktop.
  ([38c4ef1](https://github.com/YapSeng98/Personal-Planning/commit/38c4ef1))
- **Folder covers** — a Sketches folder page can have a Notion-style cover
  banner: "Add cover" under the title, then hover it to Change, Reposition
  (drag the image to pick which part shows) or Remove. Syncs across devices
  once `supabase/schema.sql` is re-run.
  ([6deea1f](https://github.com/YapSeng98/Personal-Planning/commit/6deea1f))
- **Bigger items sync now** — the server's per-request time limit went from
  8s to 60s, so a review or note can carry up to 8 MB (was ~2.5 MB) and a
  single attachment up to 5 MB (was 2 MB).
  ([62dd0d2](https://github.com/YapSeng98/Personal-Planning/commit/62dd0d2))
- **Fixed: "Sync error" that never cleared** — a Sketches note with
  full-size pasted screenshots was too big for the server, and because all
  changes went up together it blocked everything. Changes now sync in small
  groups (one bad item can't block the rest), images in notes are shrunk
  (including ones already saved), anything still too big is named in
  Settings → Sync, and the attachment limit is 2 MB.
  ([375a1c3](https://github.com/YapSeng98/Personal-Planning/commit/375a1c3))
- **Fixed: tasks without a reminder reopened as "remind on the due day"**
  after syncing (and saving them made it a real reminder). Existing records
  are cleaned up automatically on update.
  ([cdee0b6](https://github.com/YapSeng98/Personal-Planning/commit/cdee0b6))
- **AI features now work on all your devices** — the AI address set in
  Settings is saved to your account, so other signed-in devices pick it up
  on their next sync instead of hiding every AI button.
  ([cdee0b6](https://github.com/YapSeng98/Personal-Planning/commit/cdee0b6))

## 2026-10-02

- **Reviews save automatically as you type** — no more losing a half-written
  review by switching tabs or closing the app. "Auto-saved ✓" shows next to
  the button; the button still works to save + sync right away. Also made
  syncing safer: edits made while a sync is running are no longer dropped,
  and a record edited many times uploads once.
  ([3feb3bf](https://github.com/YapSeng98/Personal-Planning/commit/3feb3bf))
- **Pasting a copied note or web page into a review now attaches its
  images** — e.g. select a Sketches note with a chart in it, copy, paste into
  a review: the text goes into the field, the chart becomes an attachment.
  ([5b9b620](https://github.com/YapSeng98/Personal-Planning/commit/5b9b620))
- **Reviews can hold screenshots and files** — a new "Screenshots & files"
  section: tap Add, paste a screenshot (Ctrl/⌘+V, even while typing), or drag
  files in. Images show as thumbnails (tap for full size) and are shrunk to
  1920px so syncing stays quick; other files up to 5 MB show as chips. Needs
  the updated `supabase/schema.sql` run once to sync across devices.
  ([0411f5f](https://github.com/YapSeng98/Personal-Planning/commit/0411f5f))
- **Review text boxes grow to fit what you write** — Wins, Failures, Biggest
  lesson and Next no longer need dragging the corner to see a long entry.
  ([ebfc92c](https://github.com/YapSeng98/Personal-Planning/commit/ebfc92c))

## 2026-09-30

- **Today's hero can show what's playing in a YouTube / YouTube Music tab**
  on your computer — cover, title, artist, live progress; tap it to jump to
  that tab. Needs the new optional Chrome extension in `extension/` (load
  unpacked once, see its README). No YouTube tab, or on phone → the hero uses
  the video link from Settings as before.
  [`d0fdf4e`](https://github.com/YapSeng98/Personal-Planning/commit/d0fdf4e)
- The now-playing card now shows the **moving video**, muted (sound stays in
  your YouTube tab) and kept in step with it — play, pause and skipping all
  follow. Falls back to the still cover if a video can't be embedded.
  [`9615b6a`](https://github.com/YapSeng98/Personal-Planning/commit/9615b6a)

## 2026-09-24

- Cleared 6 Supabase security-advisor warnings: pinned `search_path` on the
  sync and trigger functions, and blocked direct calls to the signup trigger
  function. No behaviour change — signup, sync and goal roll-up re-tested.
  [`ef8ca8e`](https://github.com/YapSeng98/Personal-Planning/commit/ef8ca8e)
- Goals are **no longer marked completed automatically** when their tasks
  hit 100% — more tasks may still be added. Progress % still updates; you mark
  a goal Completed yourself, and statuses you set (Completed, At risk,
  Abandoned) are never changed by the app. Needs the updated `recalc_goal` in
  Supabase (applied). [`9c55a88`](https://github.com/YapSeng98/Personal-Planning/commit/9c55a88)
- Fixed: once a goal's only task was done, the goal completed and disappeared
  from the task goal picker, so no other task could link to it. Completed goals
  now stay in the list, marked ✓. [`1788820`](https://github.com/YapSeng98/Personal-Planning/commit/1788820)
- **Tasks can link to any goal** (Vision → Week), with the level shown in the
  picker. Goal progress is now the average of its parts — each child goal plus
  its directly linked tasks as one more part — so one finished task on a Year
  goal no longer marks it 100% done while its Quarter goals sit at 0. Goals with
  no tasks keep their manual %, and a completed goal goes back to "in progress"
  if it drops below 100%. Needs the updated `recalc_goal` in Supabase (applied).
  [`c6b227d`](https://github.com/YapSeng98/Personal-Planning/commit/c6b227d)
- Habits on Today now sit in a centred, Mac-style **dock**: tiles grow when
  you hover (neighbours grow a little too) and a glowing dot marks each habit
  done today. [`8caae85`](https://github.com/YapSeng98/Personal-Planning/commit/8caae85)
- Phone polish for the new Today: the % ring moved to the top-right of the
  panel so the briefing uses the full width, and the empty gap under the panel
  is gone. [`deabfc8`](https://github.com/YapSeng98/Personal-Planning/commit/deabfc8)
- **Today redesign: sci-fi look + new habit tiles.** The top panel is now a
  dark "HUD" panel with a live clock, a briefing that types itself out and an
  orbiting progress ring; tasks, stats and headings animate in and glow on
  hover. Habits move to one full-width row of tiles: tap the ring to log, seven
  lights show the last 7 days, streak underneath. Scrollbars are hidden across
  the app (areas still scroll). [`f4b64f1`](https://github.com/YapSeng98/Personal-Planning/commit/f4b64f1)

## 2026-09-17

- Fixed two layout bugs on **Today** on phones: the % progress ring no longer
  covers the start of the briefing text, and a long habit name (e.g. "Learning
  more than 15 min") now wraps onto two lines inside an evenly sized cell instead
  of stretching the whole habits row. [`a097408`](https://github.com/YapSeng98/Personal-Planning/commit/a097408)

## 2026-09-15

- Rewrote `README.md` — it was still describing the old ServiceNow setup and
  Phase-1 feature list. Now matches the current Supabase backend and full
  feature set. [`501fbb6`](https://github.com/YapSeng98/Personal-Planning/commit/501fbb6)
- Added `CLAUDE.md` (repo root) documenting current architecture, the
  direct-to-main git workflow, and project-specific safety rules for future
  Claude Code sessions. [`5216ad2`](https://github.com/YapSeng98/Personal-Planning/commit/5216ad2)
- Added `CHANGELOG.md` (this file) to track shipped changes. [`95fdec4`](https://github.com/YapSeng98/Personal-Planning/commit/95fdec4)
- **Design refresh** — distinctive display typeface for headings/hero/stat
  numbers, a custom line-icon set replacing emoji in nav and buttons, and a
  general polish pass (tactile button/input states, elevated login card,
  bigger folder cards). [`18c90d2`](https://github.com/YapSeng98/Personal-Planning/commit/18c90d2)
- **Sketches now sync to Supabase**, plus a new folder view to organize
  drawings and typed notes into groups. [`142dae3`](https://github.com/YapSeng98/Personal-Planning/commit/142dae3)
- **In-app Change Password** added to Settings (no email required). [`a02456e`](https://github.com/YapSeng98/Personal-Planning/commit/a02456e)
- Fixed leftover ServiceNow-specific text in Settings/Login after the backend
  switch. [`01a177c`](https://github.com/YapSeng98/Personal-Planning/commit/01a177c)
- **Backend migrated from ServiceNow to Supabase** — same sync behavior and
  username login, new Postgres backend with Row-Level Security. [`a99ec21`](https://github.com/YapSeng98/Personal-Planning/commit/a99ec21)

## 2026-08-21

- Fixed a sync bug where a real `0` value (e.g. "remind me on the due day")
  could be confused with a blank field. [`2f3e1d8`](https://github.com/YapSeng98/Personal-Planning/commit/2f3e1d8)

## 2026-08-19

- Reviews: added a date picker (jump to any past day) and the ability to
  delete a review. [`1b54bec`](https://github.com/YapSeng98/Personal-Planning/commit/1b54bec)
- Past reviews are now actually editable, not just viewable. [`cc6e3d5`](https://github.com/YapSeng98/Personal-Planning/commit/cc6e3d5)
- Board: added an "All projects" combined view. [`f4fce9d`](https://github.com/YapSeng98/Personal-Planning/commit/f4fce9d)

## 2026-08-14

- Fixed an empty "by day of week" chart for multi-tick habits (e.g. drinking
  water 8x/day). [`d5924ab`](https://github.com/YapSeng98/Personal-Planning/commit/d5924ab)

## 2026-08-13

- Added a per-habit detail page: full accumulated history + an AI insight.
  [`bac530f`](https://github.com/YapSeng98/Personal-Planning/commit/bac530f)
- Made the habit calendar heatmap actually understandable. [`866cb5e`](https://github.com/YapSeng98/Personal-Planning/commit/866cb5e)
- Fixed habit detail showing no data for multi-tick habits. [`7ad1bef`](https://github.com/YapSeng98/Personal-Planning/commit/7ad1bef)
- Switched the AI proxy from Gemini to Groq. [`1b6410e`](https://github.com/YapSeng98/Personal-Planning/commit/1b6410e)

## 2026-07-31

- Added AI features: a smart daily briefing and AI-drafted review summaries.
  [`739bcf4`](https://github.com/YapSeng98/Personal-Planning/commit/739bcf4)
- Fixed the AI proxy to use the current Gemini model + correct auth header.
  [`3ab6c1e`](https://github.com/YapSeng98/Personal-Planning/commit/3ab6c1e)

## 2026-07-24

- Fixed a real bug: clearing a field (time block, notes, hours, a goal/project
  link) didn't actually sync as cleared. Hours now sync as numbers. [`620300d`](https://github.com/YapSeng98/Personal-Planning/commit/620300d)
- Added a one-time test-data cleanup script (dry-run by default). [`1a029e8`](https://github.com/YapSeng98/Personal-Planning/commit/1a029e8)

## 2026-07-23

- Added drag-to-reorder on the Today task list, and on Plan/Board (including
  dragging a task to a different day or column). [`a85b6c8`](https://github.com/YapSeng98/Personal-Planning/commit/a85b6c8) [`9982ea3`](https://github.com/YapSeng98/Personal-Planning/commit/9982ea3)
- Plan: added a 7-day week board on laptop, with today highlighted. [`2dc5f0c`](https://github.com/YapSeng98/Personal-Planning/commit/2dc5f0c)
- Added frosted/glass backgrounds and responsive desktop layouts (Today
  became a proper laptop dashboard grid instead of a stretched phone
  layout). [`78f7190`](https://github.com/YapSeng98/Personal-Planning/commit/78f7190)

## 2026-07-22

- **Visual refresh** — the "Sunrise" coral/amber look elevated across every
  screen (gradient hero, richer task cards, momentum sparkline). [`a128e27`](https://github.com/YapSeng98/Personal-Planning/commit/a128e27)
- Added the Board / Projects feature. [`971fa77`](https://github.com/YapSeng98/Personal-Planning/commit/971fa77)

## 2026-07-12 — Phase 1

- First working version: offline-first planning PWA (Today, Plan, Goals,
  Reviews, Analytics, Settings) with a ServiceNow backend kit for sync and
  login. [`f356a62`](https://github.com/YapSeng98/Personal-Planning/commit/f356a62)
