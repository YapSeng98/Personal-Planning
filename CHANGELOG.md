# Changelog

Human-readable history of what changed in the Planner, newest first. Every
entry links to its commit on GitHub. Routine "deploy site" commits (just a
rebuild + publish, no code change) aren't listed here — see [commit
history](https://github.com/YapSeng98/Personal-Planning/commits/main) for
those.

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
