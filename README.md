# Personal Planning System

A **Vision → Year → Quarter → Month → Week → Day** planning app. Offline-first
PWA that installs on phone, iPad, and laptop, with **ServiceNow** as the system
of record (instance `dev405150.service-now.com`, scope `x_887486_persona_0`).

**Live:** https://yapseng98.github.io/Personal-Planning/ · installable to the
home screen (Add to Home Screen on iOS, Install on Chrome).

Design doc, user guide, and ServiceNow setup checklist are published as Claude
Code Artifacts.

## What it does

- **Today** — greeting + rule-based briefing, tappable habit rings with streaks,
  time-blocked tasks; an insights rail (year-goal ring, week momentum, best
  streak) on laptop and a 3-across insights row on tablet.
- **Plan** — this month's goals and the current week, day by day, with inline
  add and tap-to-edit.
- **Goals** — the full Vision→Week hierarchy; each goal has a progress bar that
  **rolls up automatically** (a task completed today moves its week goal, which
  averages up to month → quarter → year).
- **Reviews** — daily / weekly / monthly / yearly, pre-filled with your stats so
  you reflect instead of re-typing; mood + energy.
- **Analytics** — task completion (14 days), habit consistency (30 days), mood /
  energy trend, and stat tiles, all from the data you already log.
- **Settings** — light / dark / system theme, account + log out, sync status.
- **Add / edit** — one unified task form (quick-add parses "gym 6am", "2h");
  habits and goals are tap-to-edit with delete.

Everything works **offline** (writes queue locally) and **syncs** to ServiceNow
when online — same account across devices, last-write-wins on conflict.

## Layout

| Folder | What it is |
|---|---|
| `frontend/` | React + TypeScript PWA (Vite). UI reads/writes IndexedDB (Dexie); an outbox sync engine pushes/pulls to ServiceNow. |
| `servicenow/` | Instance setup: `README.md` guide, the `PlannerAuthHelper` Script Include, paste-ready Scripted REST scripts (auth + sync + dashboard + habit check-in), the roll-up Business Rule, and `smoke-test.sh`. |
| `deploy/` | `publish.sh` — build + deploy to GitHub Pages. |

## Run the frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

From the login screen, two ways in:

- **Explore offline with sample data** — no ServiceNow needed; seeds demo
  tasks / habits / goals into the local store. Fully offline.
- **Create an account / Sign in** — pick any username + password; the account
  lives in your own instance (`x_887486_persona_0_user_profile`). In dev, Vite
  proxies `/api` to the instance, so no CORS setup is needed.

## Authentication

Custom token auth (pattern borrowed from the Money Tracker, nothing shared) —
**no OAuth, no CORS rules**:

- `POST /api/x_887486_persona_0/pps/auth/{login|register|logout}` issues a
  session token stored in `x_887486_persona_0_session`.
- Every sync call carries it as the `X-Planner-Token` header.
- Scripted REST resources have "Requires authentication" **off**; the scripts
  validate the token themselves via `PlannerAuthHelper` and set CORS headers
  in-script.

## ServiceNow

Set up once in Studio (~35 min) — see `servicenow/README.md` and the setup
checklist artifact. Verify with:

```bash
sh servicenow/smoke-test.sh   # no credentials needed; self-registers a test user
```

Tables (all prefixed `x_887486_persona_0_`): `user_profile`, `session`,
`x_pps_goal`, `x_pps_task`, `x_pps_habit`, `x_pps_habit_log`, `x_pps_review`.
Goal progress is recomputed server-side inside `sync_push.js` (and by the
`Task Roll Up` Business Rule).

## Deploy

```bash
./deploy/publish.sh   # builds with the /Personal-Planning/ base path and pushes to GitHub Pages
```

## Status

Phase 1 complete and verified end-to-end (offline UI, ServiceNow sync 7/7, both
themes, phone / iPad / laptop). Possible next: Journal, Vision board,
notifications / reminders.
