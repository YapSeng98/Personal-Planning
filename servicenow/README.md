# ServiceNow setup — Personal Planning System

Instance: **dev405150.service-now.com** · Scope: **x_pps** (app name "Personal Planning System")

Follow these steps in order. Everything the frontend needs is defined here; the
JavaScript files in this folder are pasted into the instance where indicated.

> **Build note (deviation from design doc §04):** tables are created **standalone**
> rather than extending `task`. The external app never uses ServiceNow's task
> machinery (assignment, SLAs, approvals), and standalone tables keep the sync
> payload mapping 1:1. If you later want task numbering/audit, extending `task`
> remains possible — the sync scripts only care about column names.

---

## 1. Create the scoped app

Studio → Create Application → name **Personal Planning System**, scope auto-generates
(adjust to `x_pps` if offered a longer one — the REST paths below assume `x_pps`).

## 2. Create tables

Create each table in Studio (Create New → Table). Column names must match exactly —
the sync scripts map them.

### x_pps_goal
| Column | Type | Notes |
|---|---|---|
| client_uuid | String (40) | **Unique = true** |
| title | String (160) | |
| type | Choice | vision, year, quarter, month, week |
| parent_goal | Reference → x_pps_goal | |
| life_area | String (60) | (upgrade to reference table in a later pass) |
| why_it_matters | String (4000) | |
| progress | Integer | 0–100, written by the Business Rule only |
| status | Choice | not_started, in_progress, at_risk, completed, abandoned |
| target_date | Date | |
| deleted | True/False | soft-delete tombstone |

### x_pps_task
| Column | Type | Notes |
|---|---|---|
| client_uuid | String (40) | **Unique = true** |
| title | String (160) | |
| notes | String (4000) | |
| state | Choice | open, done, cancelled |
| priority | Integer | 1 critical … 5 optional |
| due | Date | |
| time_block_start | Date/Time | |
| time_block_end | Date/Time | |
| estimated_hours | Decimal | |
| actual_hours | Decimal | |
| goal | Reference → x_pps_goal | |
| is_mit | True/False | |
| deleted | True/False | |

### x_pps_habit
client_uuid (String 40, unique) · name (String 100) · emoji (String 8) ·
frequency (Choice: daily, weekly) · target_per_day (Integer) ·
active (True/False) · deleted (True/False)

### x_pps_habit_log
client_uuid (String 40, unique) · habit (Reference → x_pps_habit) ·
date (Date) · count (Integer) · deleted (True/False)

### x_pps_review
client_uuid (String 40, unique) · type (Choice: daily, weekly, monthly, yearly) ·
period_start (Date) · period_end (Date) · wins (String 4000) ·
failures (String 4000) · lesson (String 4000) ·
mood (Choice: great, good, okay, bad) · energy (Integer) ·
next_priorities (String 4000) · deleted (True/False)

## 3. Role + ACLs

1. Create role **x_pps.user** (System Security → Roles).
2. For each `x_pps_*` table create ACLs (read, write, create) requiring `x_pps.user`.
   Keep the auto-generated scope protections; do **not** grant to `public` or rely on `admin`.

## 4. Login user

Create user **pps.user** (System Security → Users): your own login for the app.
Give it exactly one role: `x_pps.user`. Set a strong password — this is what you
type into the app's login form.

## 5. Scripted REST API

Studio → Create New → Scripted REST API → name **pps** (API ID `pps`, so paths are
`/api/x_pps/pps/...`). Add resources; paste the matching file from `scripted-rest/`:

| Resource | Method | Path | Script file |
|---|---|---|---|
| Sync push | POST | /sync/push | sync_push.js |
| Sync pull | GET | /sync/pull | sync_pull.js |
| Today dashboard | GET | /dashboard/today | dashboard_today.js |
| Habit check-in | POST | /habit/{id}/checkin | habit_checkin.js |

Leave "Requires authentication" checked on all resources.

## 6. OAuth (password grant)

System OAuth → Application Registry → New → **Create an OAuth API endpoint for
external clients**. Name "Planner PWA". Note the auto-generated **Client ID** and
**Client Secret** → put them in `frontend/.env` as `VITE_SN_CLIENT_ID` /
`VITE_SN_CLIENT_SECRET`. Defaults are fine (access token 30 min, refresh 100 days).

Test from a terminal:

```bash
curl -s https://dev405150.service-now.com/oauth_token.do \
  -d grant_type=password -d client_id=<ID> -d client_secret=<SECRET> \
  -d username=pps.user -d 'password=<PASSWORD>'
```

A JSON response with `access_token` means login works end-to-end.

## 7. CORS (production hosting only)

In dev the Vite proxy handles this — skip. When the PWA is hosted on a real
domain: System Web Services → REST → CORS Rules → new rule for REST API `pps`
(and another for the Table API if used), domain = your app's origin, methods
GET/POST/PATCH.

## 8. Business Rule — progress roll-up

On **x_pps_task**: after insert/update, condition `state changes OR goal changes`.
Paste `business-rules/task_rollup.js`. This is what makes a completed task move
its Week goal's progress, then cascade Week → Month → Quarter → Year (doc §06).

## 9. Smoke test

With the frontend running (`npm run dev` in `frontend/`):
1. Sign in as `pps.user` — should land on Today.
2. Add a task via **+** ("test task 3pm") — appears instantly (local write).
3. Within a minute the sync loop pushes it; check the x_pps_task table in SN.
4. Toggle airplane mode, add another task, reconnect — it appears in SN after sync.
