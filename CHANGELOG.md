# Changelog

Human-readable history of what changed in the Planner, newest first. Every
entry links to its commit on GitHub. Routine "deploy site" commits (just a
rebuild + publish, no code change) aren't listed here — see [commit
history](https://github.com/YapSeng98/Personal-Planning/commits/main) for
those.

## 2026-09-24

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
