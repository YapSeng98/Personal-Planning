# Personal Planning System

A Vision → Year → Quarter → Month → Week → Day planning app.
Offline-first PWA frontend (phone / iPad / laptop), ServiceNow as the system of
record on **dev405150.service-now.com** (scope `x_pps`).

Design document: see the published artifact (Claude Code → Artifacts →
"Personal Planning System — Design Document").

## Layout

| Folder | What it is |
|---|---|
| `frontend/` | React + TypeScript PWA (Vite). Offline-first: UI reads/writes IndexedDB (Dexie); an outbox sync engine pushes/pulls to ServiceNow when online. |
| `servicenow/` | Everything to set up the instance: `README.md` step-by-step guide, paste-ready Scripted REST scripts, and the progress roll-up Business Rule. |

## Run the frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Two ways in from the login screen:

- **Explore offline with sample data** — no ServiceNow needed; seeds demo
  tasks/habits/goals into the local store. Works fully offline.
- **Sign in** — username/password for the `pps.user` account, once the
  ServiceNow side is set up (`servicenow/README.md`, ~30–45 min of Studio work).
  In dev, Vite proxies `/api` and `/oauth_token.do` to the instance, so no CORS
  setup is needed until production hosting.

## Status (Phase 1)

Built: app shell (bottom nav / side rail), Today screen (briefing card, tasks,
habit rings with streaks), quick-add with lightweight natural-language parsing
("gym tomorrow 6am"), offline store + outbox sync, OAuth password-grant login,
PWA install + service worker, ServiceNow table/API/Business Rule definitions.

Next: Plan (week/month) screen, Goals hierarchy screen, Reviews screen —
routes exist as stubs.
