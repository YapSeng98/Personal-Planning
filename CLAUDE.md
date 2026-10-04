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
| `frontend/` | React + TypeScript PWA (Vite). `src/db/db.ts` (Dexie schema, outbox, `patchAndQueue`), `src/sync/engine.ts` (push/pull orchestration), `src/sync/fields.ts` (which fields sync, change diffing), `src/sync/api.ts`+`supabase.ts` (Supabase client/auth), `src/lib/pwaUpdate.ts`+`public/sw-handoff.js` (how new versions reach devices), `src/styles/tokens.css`+`app.css` (design system), `src/components/Icon.tsx` (icon set). |
| `supabase/schema.sql` | Full Postgres schema: tables, RLS policies, `sync_push`/`sync_pull`/`recalc_goal` functions. Idempotent — safe to paste and re-run whole. This is the source of truth for the backend; there is no migration tool, just re-running this file in the Supabase SQL Editor. `sync_push`, `sync_pull` and the rev/field_times/txid block are **generated** by `supabase/gen_sync_push.py` (`python3 supabase/gen_sync_push.py apply` rewrites them in place) — edit the generator, not that SQL. |
| `deploy/publish.sh` | Builds the frontend and publishes it — see Deploy below. |
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
- Adding a synced field: `SYNC_FIELDS` in src/sync/fields.ts + `TABLES` in
  supabase/gen_sync_push.py → `apply` → `npm run test:sql`.

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

"Sunrise" identity — warm coral→amber gradient, defined as CSS custom
properties in `frontend/src/styles/tokens.css` (dark-first, light theme via
`prefers-color-scheme` + a `data-theme` override). Amber is decorative only —
never used for data marks (coral + green are the validated, colorblind-safe
data pair). Full palette + rationale in memory `design-language-sunrise`.

- **Typography**: Inter for body/UI (density, familiarity), Bricolage
  Grotesque (`--font-display`) for headings/hero text/big numbers only — both
  self-hosted via `@fontsource-variable/*` so the PWA still works offline.
  `h1, h2, h3` get the display font globally; there are only ~13 real heading
  tags in the whole app, so that one rule covers every page title.
- **Icons**: `frontend/src/components/Icon.tsx` — a small hand-authored
  stroke-icon set (`currentColor`, themes for free) used for nav/chrome
  (search, settings, back, delete, folder, etc). Genuinely expressive content
  (mood faces, the ✦ AI sparkle) stays as emoji on purpose — don't convert
  those.
- **Backgrounds**: `frontend/src/lib/bg.ts` — user-selectable colour-glow
  presets (`data-bg` attribute), triggers frosted-glass treatment on cards
  when active. Don't hardcode a background assumption into new components.

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
