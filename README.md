# Personal Planning System

A **Vision → Year → Quarter → Month → Week → Day** planning app. Offline-first
PWA that installs on phone, iPad, and laptop, backed by **Supabase**
(Postgres + Auth) for sync and login.

**Live:** https://yapseng98.github.io/Personal-Planning/ · installable to the
home screen (Add to Home Screen on iOS, Install on Chrome).

See `CLAUDE.md` for architecture/workflow notes and `CHANGELOG.md` for a
running history of what shipped.

## What it does

- **Today** — a sunrise gradient hero with an AI-drafted daily briefing (rule-
  based fallback if AI isn't configured), reminders banner, tappable habit
  rings with streaks, time-blocked tasks (drag to reorder), a week-momentum
  sparkline, and a year-goal ring.
- **Plan** — the current week day by day (drag tasks between days/columns),
  plus a month calendar view.
- **Board** — Jira-style project board (To Do / In Progress / Done columns,
  drag-and-drop) with a projects overview strip and per-project stats.
- **Goals** — the full Vision→Week hierarchy; each goal's progress bar
  **rolls up automatically** (completing a task moves its week goal, which
  averages up to month → quarter → year).
- **Habits** — daily/weekly targets with streaks; a per-habit detail page
  with full history, a calendar heatmap, and an AI insight.
- **Reviews** — daily / weekly / monthly / yearly, pre-filled with your stats
  so you reflect instead of re-typing; mood + energy, AI-drafted summaries.
- **Sketches** — freehand drawing or typed notes, organized into folders.
- **Analytics** — task completion, habit consistency, mood/energy trend, and
  stat tiles, all from data you already log.
- **Search** — Cmd/Ctrl+K, searches tasks, goals, and sketches.
- **Recurring tasks** — daily/weekly/monthly, one row per occurrence, full
  history kept.
- **Settings** — theme, background, language (EN/中文), AI proxy URL, change
  password, sync status.

Everything works **offline** (writes queue locally in IndexedDB via Dexie)
and **syncs** to Supabase when online — same account across devices,
last-write-wins on conflict.

## Layout

| Folder | What it is |
|---|---|
| `frontend/` | React + TypeScript PWA (Vite). UI reads/writes IndexedDB (Dexie); an outbox sync engine pushes/pulls to Supabase. |
| `supabase/schema.sql` | Full Postgres schema — tables, RLS policies, and the `sync_push`/`sync_pull`/`recalc_goal` functions the frontend calls. Paste-and-run in the Supabase SQL Editor (idempotent). |
| `ai-proxy/` | Optional Cloudflare Worker proxying AI calls (briefings, review drafts, habit insights) — the frontend works fine without it, just without those features. |
| `deploy/` | `publish.sh` — build + publish to GitHub Pages. |
| `servicenow/` | Legacy — the original backend, replaced by Supabase in September 2026. Kept for history only, not live. |

## Run the frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

You'll need `frontend/.env.local` (gitignored) with your own Supabase
project's URL + anon key:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

From the login screen, two ways in:

- **Explore offline with sample data** — no account needed; seeds demo
  tasks/habits/goals into the local store. Fully offline, no Supabase config
  required either.
- **Create an account / Sign in** — pick any username + password. Login is
  username-only under the hood (a deterministic "shadow email" maps it to
  Supabase Auth, which is email-native) — you never see or need a real email.

## Backend (Supabase)

Set up once by pasting `supabase/schema.sql` into your project's SQL Editor
and running it — it creates every table, enables Row-Level Security
(`user_id = auth.uid()` is the actual multi-tenant boundary), and defines the
`sync_push`/`sync_pull`/`recalc_goal` functions the frontend calls via
`supabase.rpc(...)`. Safe to re-run the whole file any time (every statement
is guarded).

A database trigger auto-confirms new signups (works around Supabase's
low-volume default email rate limit) and creates the matching `profiles` row
— no `service_role` key is used anywhere in this app.

## Deploy

```bash
./deploy/publish.sh   # builds with the /Personal-Planning/ base path and pushes to GitHub Pages
```

GitHub Pages serves the root of `main` directly (no Actions workflow, no
gh-pages branch) — the script builds, copies `frontend/dist/` to the repo
root, commits, and pushes. This only publishes the frontend; a Supabase
schema change is a separate step (see above).

## Status

Actively developed. See `CHANGELOG.md` for what's shipped recently.
