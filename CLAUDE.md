# CLAUDE.md

Guidance for Claude Code working in this repo. Personal single-user project
(owner: YC) — no team, no reviewers, optimize for shipping fast and safely,
not for process.

## What this is

A Vision → Year → Quarter → Month → Week → Day planning PWA. Offline-first:
UI reads/writes IndexedDB (Dexie) directly; a sync engine pushes/pulls to the
backend in the background. Live at https://yapseng98.github.io/Personal-Planning/
(installable — Add to Home Screen / Install on Chrome).

**Backend is Supabase** (project `rleqtargnhpsojfpegtf`), migrated from
ServiceNow in September 2026. `servicenow/` is kept in the repo for history
only — it is not live and should not be treated as current architecture.

## Layout

| Path | What it is |
|---|---|
| `frontend/` | React + TypeScript PWA (Vite). `src/db/db.ts` (Dexie schema, outbox, `patchAndQueue`), `src/sync/engine.ts` (push/pull orchestration), `src/sync/fields.ts` (which fields sync, change diffing), `src/sync/api.ts`+`supabase.ts` (Supabase client/auth), `src/lib/pwaUpdate.ts`+`public/sw-handoff.js` (how new versions reach devices), `src/styles/tokens.css`+`app.css` (design system), `src/components/Icon.tsx` (icon set), `src/lib/command.ts`+`components/AskBar.tsx` (Today's "Ask Planner" command bar: rule-based commands, AI fallback, every change undoable), `src/lib/focus.ts`+`components/FocusMode.tsx` (full-screen focus timer / Pomodoro on top of `lib/timer.ts`). |
| `supabase/schema.sql` | Full Postgres schema: tables, RLS policies, `sync_push`/`sync_pull`/`recalc_goal` functions. Idempotent — safe to paste and re-run whole. This is the source of truth for the backend; there is no migration tool, just re-running this file in the Supabase SQL Editor. `sync_push`, `sync_pull` and the rev/field_times/txid block are **generated** by `supabase/gen_sync_push.py` (`python3 supabase/gen_sync_push.py apply` rewrites them in place) — edit the generator, not that SQL. |
| `deploy/publish.sh` | Builds the frontend and publishes it — see Deploy below. |
| `supabase/functions/push-reminders/` | Edge Function that sends reminder pushes (Web Push, encrypted per device). Called once a minute by the database (`send_due_reminders` in schema.sql, scheduled by `supabase/push_setup.sql`), which also works out what's due; the function has no secrets or database access — the VAPID private key comes from Vault with each request and only the app's own key is accepted. Deployed by hand in the dashboard (JWT verification off). The app's side: `src/lib/reminders.ts` (also reminds by itself while open), `public/sw-notify.js` (push + notification taps). `npm run test:push` checks its crypto. |
| `extension/` | Optional Chrome extension ("Planner Now Playing") — mirrors what's playing in a YouTube / YouTube Music tab onto the Today hero via `postMessage`; the page reads it in `src/lib/nowPlaying.ts`. Desktop only; without it the hero uses the Settings video link. Load unpacked, see its README. |
| `servicenow/` | Legacy — the pre-Supabase backend. Not live, kept for history. |
| `CHANGELOG.md` | Human-readable history of what shipped, newest first. |

## Sync model — read before touching sync or any screen that saves

Several devices edit the same data, often while offline or with a screen
left open. The rule that keeps one device from undoing another's changes:

- **Never write a whole record from a screen's copy.** Save through
  `patchAndQueue(table, name, id, patch, att?)` (db.ts): the patch is applied
  to the record as stored *now*, and only the fields that changed are queued.
  `writeAndQueue` is for brand-new records. Attachments change only by
  add/remove ops (`att`), never by passing a whole list.
- `sync_push` applies each pushed field only if its edit time is at least as
  recent as that field's last applied edit (`field_times`), so the latest
  edit of a field wins in any sync order. Attachments merge by id.
- Every row has `rev` (bumped on any write) and `txid` (the writing
  transaction). A push from a stale `base_rev` comes back `foreign`, and the
  device pulls the merged row. A device's local `rev` only advances when its
  copy matches the server's.
- The pull cursor is a Postgres snapshot, not a timestamp, so a save still
  committing during a pull is picked up next time. A device skips its own
  echo by `"<id>#<rev>"`.
- Records two devices may create independently (a day's review, a habit's
  day, a repeat's date) get content-derived ids (`uuidFrom`) — include the
  account id when the content alone isn't account-specific.
- Screens that stay open while syncs arrive (Reviews, SketchDetail) merge
  incoming changes into what's on screen and run loads/saves one at a time.
- Lists that two devices edit item by item — a task's `checklist` (steps)
  and `focusLog` (timer sessions, per day) — merge per item on the server
  (`merge_items`, by each item's own edit time `t`; removed items stay as
  `{id, del: 1, t}`) and the same way on a device (lib/items.ts →
  `mergeItems`, used by the pull for unsent edits). Change them only with
  `editTaskList` (db.ts), never by writing a list from a screen's copy, and
  never drop an item from the list — mark it removed. A new list field:
  `ITEM_FIELDS` in both fields.ts and gen_sync_push.py.
- Adding a synced field: `SYNC_FIELDS` + `LATER_FIELDS` in src/sync/fields.ts,
  `TABLES` + `LATER` in supabase/gen_sync_push.py, and its column in
  schema.sql (`add column if not exists`) → `apply` → `npm run test:sql`.
- The browser's sign-in is shared with the Daily Brief app (same site, same
  Supabase storage key): signing in or out there does the same here. A
  device's data belongs to `planner_data_owner`; when the session is a
  different account, sync stops ('other-account' state) — never push one
  account's local data into another. Daily Brief writes Planner tasks only
  through `sync_push` (footer "— Daily Brief ·" in the notes; see lib/tasks.ts).
- The app deploys itself; schema.sql is run by hand — so the app is often
  ahead of the database. `sync_pull` lists the fields the server has, and a
  change to a field that isn't listed is held back (stays queued, Settings
  says what it's waiting for) and sent once it is. Never send a field to a
  server that can't store it: it would record an edit time and drop the value.

## Git workflow — direct to `main`, no PRs

This is a solo project; PRs would add friction with no one to review. Commit
and push straight to `main`. The trade-off this accepts: verify *before*
pushing, since there's no review step catching problems after.

- Test/verify a change before pushing it (see Verifying below) — that
  replaces the review step a PR would normally give you.
- Exception: if a change is genuinely risky or hard to undo (a schema change,
  a cutover), it's fine to put it on a branch first so the owner can glance
  at it — same pattern as the original `feat/supabase-backend` migration.
- **Update `CHANGELOG.md` whenever a change ships** — add an entry (newest on
  top, grouped by date, link the commit), not just when asked. Routine
  `deploy site …` rebuild commits don't get an entry; the actual
  feature/fix commit does.

## Deploy

```bash
./deploy/publish.sh
```

Builds with `GH_PAGES=1` (correct base path), copies `frontend/dist/` to the
repo root, commits `deploy site <date>`, pushes to `origin/main`. GitHub
Pages serves the root of `main` directly — no Actions workflow, no gh-pages
branch. Live within about a minute of push.

**Supabase-side changes** (schema/RLS/functions) are separate from a frontend
deploy: paste `supabase/schema.sql` into the Supabase SQL Editor and run it.
Nothing in `deploy/publish.sh` touches Supabase.

## Verifying a change

The real test surface is the **live deployed site** — there is no way to
reach a local `npm run dev` server from the browser automation tool in this
environment (different network namespace), so don't rely on localhost for
visual/UI verification. Two verification paths, pick based on what changed:

- **UI/visual changes**: deploy, then drive the live site (Playwright, or
  Claude-in-Chrome browser tools). Enter via **"Explore offline with sample
  data"** on the login screen — no account needed, seeds realistic demo data,
  fully local. See `.claude/skills/verify/SKILL.md` for a driven-flow recipe
  and known selector gotchas.
- **Sync/backend changes**: hit `sync_push`/`sync_pull` directly (curl or a
  small script) against a **disposable test account** signed up fresh for
  the test — never experiment against the owner's real account. Confirm the
  actual round-trip (push a value, pull it back, check it matches), not just
  that the call returned 200.
- **Schema changes**: `npm run test:sql` (in `frontend/`) before handing the
  SQL over — it runs the real schema.sql twice (idempotency) in a local
  Postgres (PGlite) and checks the merge rules. For anything that changes
  existing objects, also run it over the live version
  (`git show HEAD:supabase/schema.sql`) with data in it first. Multi-device
  conflict suite (3 browsers, sync routed to PGlite): see the verify skill.

**New versions on devices**: the app reloads itself into a new version when
it goes to the background or comes back (`src/lib/pwaUpdate.ts`); Settings →
Version shows the build a device runs. Devices on a version from before
2026-10-04 switch on their first launch after a release (`sw-handoff.js`).

**PWA cache gotcha**: after deploying, a tab can still serve the old bundle.
`navigator.serviceWorker.getRegistrations()` → unregister all, `caches.keys()`
→ delete all, is not enough by itself — the browser's plain HTTP cache can
still serve stale `index.html` pointing at the old JS hash even after that.
Force a real fetch with a cache-busting query string (`?v=2`) or confirm via
`fetch(url, {cache:'no-store'})` before trusting what you see.

**Build check that actually matches deploy**: `tsc --noEmit -p .` is not a
reliable proxy — it has passed clean while the real build command (`tsc -b`,
project-references mode, what `publish.sh` runs) caught a real type error.
Run `npm run build` (or at least `tsc -b`) before deploying, not just
`--noEmit`.

## Design system

**Liquid Glass** (since 2026-10-30, picked by the owner from previews) over
the "Sunrise" identity. Two layers:

- `frontend/src/styles/tokens.css` + `app.css` — the base tokens and every
  component's layout/styles (coral→amber Sunrise palette; amber decorative
  only — coral + green are the validated, colorblind-safe data pair).
- `frontend/src/styles/glass.css` — loaded last; the Liquid Glass look on
  top: theme tokens (`--glass`, `--surface`, text) re-tuned for glass, the
  glass material (`--g-blur`, `--g-border`, `--g-rim`, `--g-shadow`,
  `--g-sheet`, `--g-bar`) applied to every top-level surface (cards, task
  cards, sheets, menus, banners, the pop-up window), a fixed wallpaper layer
  (`body::before`, `--app-bg`; iOS ignores `background-attachment: fixed`),
  the phone's floating glass tab bar (shrinks to the current page while
  YOU scroll down — finger/wheel/keys only, never the app restoring a
  scroll on Back — `.nav-bottom.compact`, Shell.tsx; a tap opens it again),
  the desktop's floating glass sidebar, round tick boxes, capsule buttons,
  solid-ink primary buttons (`--g-ink`), and Today's hero as glass with a
  turning colour edge. It changes looks only — no markup depends on it.
  New surfaces: give them `background: var(--glass)` and add their class to
  the glass material list in glass.css. Don't blur glass inside glass
  (costly, muddy) — inner elements use translucent fills only.
- Sheets/menus/tab bar keep enough tint (`--g-sheet` ~0.9, `--g-bar` ~0.7)
  to stay readable where the blur isn't drawn (Playwright WebKit doesn't
  render backdrop-filter; real Safari does).
- `frontend/src/styles/cosmic.css` — loaded after glass.css; the **Cosmic**
  look (since 2026-10-30, from the owner's "more future and advanced"
  references), active only with `data-bg='cosmic'`: always dark, deep-space
  wallpaper (tiled star layers — needs the `background` shorthand, not
  `background-image` — a planet's glowing rim, nebula), neon cyan → violet →
  pink rims/rings/bars/nav glow, Sora headings (`@fontsource-variable/sora`)
  with glowing titles (no gradient-filled text: it blanks emoji in titles),
  data marks violet (`--accent`) + green. Everything scoped under
  `:root[data-bg='cosmic']`, so Liquid and the other backgrounds are untouched.
- `frontend/src/styles/focus.css` — focus mode's full-screen deep-space
  timer: its own always-dark look in every theme (not scoped to Cosmic).
- **Wallpaper**: `frontend/src/lib/bg.ts` presets (`data-bg`); `cosmic` is
  the default (every device switched to it once via `planner_bg_v3`; before
  that `liquid` via `planner_bg_v2`), the others stay selectable in
  Settings → Background. `applyBg` re-runs `applyTheme` so the window bar
  colour follows (Cosmic: #050716).
- **Typography**: Inter for body/UI; headings Inter (Liquid) or Sora
  (Cosmic) — iOS-style tight, heavy large titles. Self-hosted via
  `@fontsource-variable/*` so the PWA works offline (Bricolage is no longer
  loaded).
- **Icons**: `frontend/src/components/Icon.tsx` — a small hand-authored
  stroke-icon set (`currentColor`, themes for free) for nav/chrome.
  Genuinely expressive content (mood faces, the ✦ AI sparkle) stays emoji on
  purpose — don't convert those.

## Safety notes specific to this project

- Never run experiments (signup spam, sync stress tests, bulk writes)
  against the owner's real Supabase account. Use a disposable test
  username, or the offline demo mode.
- Never request or use the Supabase `service_role` key — everything this app
  needs is doable as an authenticated user under RLS. If something seems to
  need `service_role`, that's a sign to re-check the RLS policy instead.
- A native `window.confirm()`/`alert()` dialog freezes browser automation
  (CDP) entirely. Avoid triggering one via a scripted click if avoidable;
  recover with a keyboard `Return`/`Escape` or by closing and reopening the
  tab.
