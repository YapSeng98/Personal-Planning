# ServiceNow setup — Planner (Money Tracker pattern)

Instance: **dev405150.service-now.com** · App: the existing **PFMT / Money Tracker**
scoped app (`x_887486_0`) — the Planner lives inside it and reuses its auth.

The integration copies the proven Money Tracker pattern:

- **Auth**: the shared `/api/x_887486_0/pfmt/auth/login` issues a session token
  (`X-PFMT-Token`); the same account works in both apps. No OAuth, no SN users.
- **CORS**: set in-script (`Access-Control-Allow-Origin: *`), so the GitHub
  Pages app calls the instance directly. No CORS rules needed.
- **Endpoints**: "Requires authentication" = **false** on every resource; the
  scripts validate the token themselves via `PFMTAuthHelper`.
- **Data scoping**: every Planner table has a `user_profile` reference; all
  reads/writes filter by the token's profile — same as `x_887486_0_transaction`.

## What to create (in Studio, inside the PFMT app)

1. **Five tables** — `pps_goal`, `pps_task`, `pps_habit`, `pps_habit_log`,
   `pps_review` (Studio prefixes them to `x_887486_0_pps_*`). Full column
   definitions: see the setup checklist artifact, or infer from the field
   maps in `scripted-rest/sync_push.js`. Every table also gets:
   `client_uuid` (String 40, unique), `user_profile` (Reference →
   `x_887486_0_user_profile`), `deleted` (True/False).
2. **Scripted REST API** — name "Planner API", API ID `planner`. Resources
   (auth unchecked on all): POST `/sync/push`, GET `/sync/pull`,
   GET `/dashboard/today`, POST `/habit/checkin` — paste the matching file
   from `scripted-rest/`.
3. **Business Rule** on `x_887486_0_pps_task` (after insert/update, condition:
   state changes OR goal changes) — paste `business-rules/task_rollup.js`.

## Verify

```bash
sh servicenow/smoke-test.sh
```

No credentials needed — it logs in as a dedicated `planner_e2e` account through
the live PFMT auth endpoint and exercises every Planner endpoint: push a task,
pull it back, dashboard aggregate, and the no-token 401 guard.
