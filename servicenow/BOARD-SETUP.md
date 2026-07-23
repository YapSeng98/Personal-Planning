# ServiceNow setup — Board / Project feature

Complete, exact spec for the instance-side work the Board feature needs.
Do this in **Studio**, inside your Planner app.

- **Instance:** dev405150.service-now.com
- **App scope:** `x_887486_persona_0`
- **Scripts already updated in this repo:** `scripted-rest/sync_pull.js`, `scripted-rest/sync_push.js`

> **Why names matter:** the sync scripts look up the table, columns, and the
> task field by their **exact internal name**. If any name is off, that data
> silently won't sync. Every internal name below must be typed exactly.

---

## 1. New table: `x_pps_project`

Create a new table. Its full **Name** must end up exactly:

```
x_887486_persona_0_x_pps_project
```

(In the Name field you type `x_pps_project` after the fixed `x_887486_persona_0_`
scope prefix — same pattern as your existing `x_887486_persona_0_x_pps_task`.)

Do **not** set "Extends table" — this is a standalone table, like your other 5.

### Columns

| Column label | Internal name | Type       | Max length | Notes                                                                 |
|--------------|---------------|------------|-----------:|-----------------------------------------------------------------------|
| Client UUID  | `client_uuid` | String     |         40 | Add a **unique index** on it — same as your other Planner tables      |
| User Profile | `user_profile`| Reference  |          — | References `x_887486_persona_0_user_profile`                          |
| Deleted      | `deleted`     | True/False |          — | Default `false`                                                       |
| Title        | `title`       | String     |        100 | The project name                                                      |
| Color        | `color`       | String     |         40 | Stores a keyword like `blue` (longest value is `purple`, 6 chars)     |
| Archived     | `archived`    | True/False |          — | Default `false`                                                       |

The first three (`client_uuid`, `user_profile`, `deleted`) are the universal
columns every Planner table has — copy them exactly from how `x_pps_task` is set
up. The last three are new.

---

## 2. New field on the task table: `project`

Open **`x_887486_persona_0_x_pps_task`** and add one column:

| Column label | Internal name | Type      | References                          |
|--------------|---------------|-----------|-------------------------------------|
| Project      | `project`     | Reference | `x_887486_persona_0_x_pps_project`  |

This mirrors the existing `goal` reference field already on the task table —
set it up the same way, just pointing at the new project table.

### (Optional) `sort_order` for drag-to-reorder sync

Drag-to-reorder on the Plan and Board screens stores a per-task order in a
`sort_order` field. Reordering works locally without this; add the column so
the order **syncs across devices**:

| Column label | Internal name | Type    |
|--------------|---------------|---------|
| Sort Order   | `sort_order`  | Integer |

The updated `sync_pull.js`/`sync_push.js` already map it. If you skip this,
reordering still works on each device but the order won't travel between them.

---

## 3. Check the task `state` field

Open the **`state`** field on `x_887486_persona_0_x_pps_task` (its dictionary
entry) and look at its **Type**:

- **If Type is "Choice"** (fixed value list): go to its **Choices** related list
  and add one new choice —
  - Label: `In progress`
  - Value: `in_progress`
- **If Type is "String"** (plain text): nothing to do — it already accepts any value.

The three existing values are `open`, `done`, `cancelled`; you're adding a
fourth, `in_progress`, between open and done. (Your goal `status` field already
stores `in_progress`, so if `state` is a Choice field, this is the same one-value
addition you've done before.)

---

## 4. Re-paste the two sync scripts

Copy each repo file's full contents into its matching Scripted REST resource in
Studio (Planner API). **Only these two change** — the other resources and the
Business Rule are untouched.

| Repo file                             | Scripted REST resource      |
|---------------------------------------|-----------------------------|
| `scripted-rest/sync_pull.js`          | GET `/sync/pull`            |
| `scripted-rest/sync_push.js`          | POST `/sync/push`           |

Keep "Requires authentication" **unticked** on both (it already is).

No Business Rule changes — `business-rules/task_rollup.js` only reads
`goal`/`deleted`/`state` on task and doesn't need to know about `project`.

---

## 5. Verify

From the repo folder:

```bash
sh servicenow/smoke-test.sh
```

These four new checks (step 7) must pass:

- `project title round-trips`
- `project color round-trips`
- `task state in_progress round-trips`  ← if this fails, the Choice value (step 3) wasn't added
- `task links to project`  ← if this fails, re-check the table name (step 1) or the `project` field name (step 2)

When all four pass, the instance side is done and the frontend branch can be
deployed.

---

## Everything the scripts look up by exact name (recap)

- Table: `x_887486_persona_0_x_pps_project`
- Project columns: `title`, `color`, `archived`, `deleted`, `client_uuid`, `user_profile`
- Task's new field: `project`
- Task state value: `in_progress`
