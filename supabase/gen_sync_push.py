"""Generate the field-merging sync_push (+ supporting DDL) for supabase/schema.sql.

Usage (from the repo root):
    python3 supabase/gen_sync_push.py ddl    # rev / field_times / txid / helpers
    python3 supabase/gen_sync_push.py push   # the sync_push function
    python3 supabase/gen_sync_push.py pull   # the sync_pull function
    python3 supabase/gen_sync_push.py apply  # rewrite all three blocks in schema.sql
Then run `npm run test:sql` in frontend/ (real Postgres via PGlite) before
deploying. Adding a synced field = add it here AND to SYNC_FIELDS in
frontend/src/sync/fields.ts.

One spec per synced table: (json field, column, SQL expression reading the
payload `p`). The field lists MUST match SYNC_FIELDS in
frontend/src/sync/fields.ts.
"""

ATT = "case when jsonb_typeof(p->'attachments') = 'array' then p->'attachments' else '[]'::jsonb end"

TABLES = [
    ('task', 'tasks', [
        ('title', 'title', "coalesce(nullif(p->>'title', ''), '')"),
        ('notes', 'notes', "nullif(p->>'notes', '')"),
        ('state', 'state', "coalesce(nullif(p->>'state', ''), 'open')"),
        ('priority', 'priority', "coalesce(nullif(p->>'priority', '')::int, 3)"),
        ('due', 'due', "nullif(p->>'due', '')::date"),
        ('timeBlockStart', 'time_block_start', "nullif(p->>'timeBlockStart', '')::timestamptz"),
        ('timeBlockEnd', 'time_block_end', "nullif(p->>'timeBlockEnd', '')::timestamptz"),
        ('estimatedHours', 'estimated_hours', "nullif(p->>'estimatedHours', '')::numeric"),
        ('actualHours', 'actual_hours', "nullif(p->>'actualHours', '')::numeric"),
        ('goalId', 'goal_id', "nullif(p->>'goalId', '')::uuid"),
        ('projectId', 'project_id', "nullif(p->>'projectId', '')::uuid"),
        ('isMit', 'is_mit', "coalesce(nullif(p->>'isMit', '')::boolean, false)"),
        ('sortOrder', 'sort_order', "nullif(p->>'sortOrder', '')::int"),
        ('reminderDaysBefore', 'reminder_days_before', "nullif(p->>'reminderDaysBefore', '')::int"),
        ('recurrence', 'recurrence', "nullif(p->>'recurrence', '')"),
        ('seriesId', 'series_id', "nullif(p->>'seriesId', '')::uuid"),
        ('deleted', 'deleted', "coalesce(nullif(p->>'deleted', '')::boolean, false)"),
    ]),
    ('habit', 'habits', [
        ('name', 'name', "coalesce(nullif(p->>'name', ''), '')"),
        ('emoji', 'emoji', "nullif(p->>'emoji', '')"),
        ('frequency', 'frequency', "coalesce(nullif(p->>'frequency', ''), 'daily')"),
        ('targetPerDay', 'target_per_day', "coalesce(nullif(p->>'targetPerDay', '')::int, 1)"),
        ('active', 'active', "coalesce(nullif(p->>'active', '')::boolean, true)"),
        ('deleted', 'deleted', "coalesce(nullif(p->>'deleted', '')::boolean, false)"),
    ]),
    ('habit_log', 'habit_logs', [
        ('habitId', 'habit_id', "nullif(p->>'habitId', '')::uuid"),
        ('date', 'date', "nullif(p->>'date', '')::date"),
        ('count', 'count', "coalesce(nullif(p->>'count', '')::int, 0)"),
        ('deleted', 'deleted', "coalesce(nullif(p->>'deleted', '')::boolean, false)"),
    ]),
    ('goal', 'goals', [
        ('title', 'title', "coalesce(nullif(p->>'title', ''), '')"),
        ('type', 'type', "coalesce(nullif(p->>'type', ''), 'week')"),
        ('parentId', 'parent_id', "nullif(p->>'parentId', '')::uuid"),
        ('lifeArea', 'life_area', "nullif(p->>'lifeArea', '')"),
        ('whyItMatters', 'why_it_matters', "nullif(p->>'whyItMatters', '')"),
        ('progress', 'progress', "coalesce(nullif(p->>'progress', '')::int, 0)"),
        ('status', 'status', "coalesce(nullif(p->>'status', ''), 'not_started')"),
        ('targetDate', 'target_date', "nullif(p->>'targetDate', '')::date"),
        ('deleted', 'deleted', "coalesce(nullif(p->>'deleted', '')::boolean, false)"),
    ]),
    ('review', 'reviews', [
        ('type', 'type', "coalesce(nullif(p->>'type', ''), 'daily')"),
        ('periodStart', 'period_start', "nullif(p->>'periodStart', '')::date"),
        ('periodEnd', 'period_end', "nullif(p->>'periodEnd', '')::date"),
        ('wins', 'wins', "nullif(p->>'wins', '')"),
        ('failures', 'failures', "nullif(p->>'failures', '')"),
        ('lesson', 'lesson', "nullif(p->>'lesson', '')"),
        ('mood', 'mood', "nullif(p->>'mood', '')"),
        ('energy', 'energy', "nullif(p->>'energy', '')::int"),
        ('nextPriorities', 'next_priorities', "nullif(p->>'nextPriorities', '')"),
        ('attachments', 'attachments', ATT),
        ('deleted', 'deleted', "coalesce(nullif(p->>'deleted', '')::boolean, false)"),
    ]),
    ('project', 'projects', [
        ('title', 'title', "coalesce(nullif(p->>'title', ''), '')"),
        ('color', 'color', "coalesce(nullif(p->>'color', ''), 'coral')"),
        ('archived', 'archived', "coalesce(nullif(p->>'archived', '')::boolean, false)"),
        ('deleted', 'deleted', "coalesce(nullif(p->>'deleted', '')::boolean, false)"),
    ]),
    ('drawing', 'drawings', [
        ('title', 'title', "coalesce(nullif(p->>'title', ''), '')"),
        ('kind', 'kind', "coalesce(nullif(p->>'kind', ''), 'draw')"),
        ('dataUrl', 'data_url', "nullif(p->>'dataUrl', '')"),
        ('text', 'text', "nullif(p->>'text', '')"),
        ('format', 'format', "nullif(p->>'format', '')"),
        ('attachments', 'attachments', ATT),
        ('folderId', 'folder_id', "nullif(p->>'folderId', '')::uuid"),
        ('deleted', 'deleted', "coalesce(nullif(p->>'deleted', '')::boolean, false)"),
    ]),
    ('folder', 'sketch_folders', [
        ('name', 'name', "coalesce(nullif(p->>'name', ''), '')"),
        ('parentId', 'parent_id', "nullif(p->>'parentId', '')::uuid"),
        ('cover', 'cover', "nullif(p->>'cover', '')"),
        ('coverY', 'cover_y', "nullif(p->>'coverY', '')::int"),
        ('coverH', 'cover_h', "nullif(p->>'coverH', '')::real"),
        ('deleted', 'deleted', "coalesce(nullif(p->>'deleted', '')::boolean, false)"),
    ]),
]


def arr(fields):
    return "array[" + ", ".join(f"'{f}'" for f in fields) + "]"


def branch(key, table, spec, first):
    fields = [f for f, _, _ in spec]
    cols = ", ".join(c for _, c, _ in spec)
    exprs = ",\n            ".join(e for _, _, e in spec)
    legacy_set = ",\n            ".join(f"{c} = {e}" for _, c, e in spec)
    merge_set = []
    for f, c, e in spec:
        if f == 'attachments':
            merge_set.append(
                f"{c} = case when 'attachments' = any(flds) then public.merge_attachments({c},\n"
                f"              (select coalesce(jsonb_agg(a), '[]'::jsonb) from jsonb_array_elements({ATT}) a where a->>'id' = any(att_up)),\n"
                f"              att_rm) else {c} end")
        else:
            merge_set.append(f"{c} = case when '{f}' = any(win) then {e} else {c} end")
    merge_set = ",\n            ".join(merge_set)
    is_task = key == 'task'
    is_goal = key == 'goal'
    sel_extra = ", goal_id" if is_task else ""
    into_extra = ", ex_goal" if is_task else ""
    kw = "if" if first else "elsif"

    def after_apply(path):
        # goal roll-ups to recompute after this item
        if is_task:
            if path == 'merge':
                return ("        if win && array['goalId', 'state', 'deleted'] then\n"
                        "          if ex_goal is not null then affected_goals := affected_goals || ex_goal; end if;\n"
                        "          if new_goal is not null then affected_goals := affected_goals || new_goal; end if;\n"
                        "        end if;\n")
            return ("        if new_goal is not null then affected_goals := affected_goals || new_goal; end if;\n"
                    "        if ex_goal is not null and ex_goal is distinct from new_goal then affected_goals := affected_goals || ex_goal; end if;\n")
        if is_goal:
            return "        affected_goals := affected_goals || rid;\n"
        return ""

    ret_goal = ", goal_id into new_rev, new_goal" if is_task else " into new_rev"
    ret_goal_ins = ", goal_id into new_rev, new_goal" if is_task else " into new_rev"
    return f"""
    {kw} tbl = '{key}' then
      select rev, coalesce(field_times, '{{}}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz){sel_extra}
        into ex_rev, ex_ft, existing_updated{into_extra}
        from public.{table} where id = rid and user_id = auth.uid() for update;
      if not found then
        -- new record: insert every column, but stamp edit times only on the
        -- fields this device actually filled — an empty field it never wrote
        -- must not outrank another device's earlier edit of that field
        insert into public.{table} (id, user_id, edited_at, field_times, {cols})
        values (rid, auth.uid(), edited_ts,
            coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(flds) f), '{{}}'::jsonb),
            {exprs})
        on conflict (id) do nothing
        returning rev{ret_goal_ins};
        if new_rev is not null then
          results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied', 'rev', new_rev, 'foreign', false);
{after_apply('insert')}        else
          -- another device created this same record (same id: a day's
          -- review, a habit's day) between the lookup above and this
          -- insert — merge into it below rather than drop this one
          select rev, coalesce(field_times, '{{}}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz){sel_extra}
            into ex_rev, ex_ft, existing_updated{into_extra}
            from public.{table} where id = rid and user_id = auth.uid() for update;
        end if;
      end if;
      if new_rev is null and ex_rev is null then
        -- the id belongs to a row this account can't see: say so (the app
        -- keeps the change and reports it) instead of claiming it saved
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'rejected');
      elsif new_rev is null then
        -- field-level merge: apply only the fields this device changed, and
        -- for each, only if its edit is at least as recent as the server's
        win := array(select f from unnest(flds) f
                     where coalesce((fts->>f)::bigint, edited_ms) >= coalesce((ex_ft->>f)::bigint, 0));
        update public.{table} set
            {merge_set},
            field_times = ex_ft || coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(win) f), '{{}}'::jsonb),
            edited_at = greatest(existing_updated, edited_ts)
          where id = rid and user_id = auth.uid()
          returning rev{ret_goal};
        -- foreign: the row holds something this device hasn't seen — changes
        -- from elsewhere since its base, or one of its own fields lost to a
        -- newer edit — so it must pull the row instead of skipping its echo
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied',
          'rev', new_rev, 'foreign', ex_rev is distinct from base_rev
            or coalesce(array_length(win, 1), 0) < coalesce(array_length(flds, 1), 0));
{after_apply('merge')}      end if;
"""


def sync_push():
    branches = "".join(branch(k, t, s, i == 0) for i, (k, t, s) in enumerate(TABLES))
    return f"""-- ------------------------------------------------------------
-- sync_push — items: jsonb array of
--   {{table, client_uuid, payload, edited_at, base_rev, fields, field_times, att_up, att_rm}}
-- payload always carries every syncable field ('' = cleared; every cast goes
-- through nullif(x,'') so '' means "clear this", never "0" or a cast error).
--
-- Field-level merge (current app): `fields` lists only what the device
-- changed; each is applied only if its edit time (field_times[f]) is at
-- least as recent as the server's time for that field — so a device holding
-- an older copy never overwrites changes it didn't make, and for any one
-- field the most recent edit wins whatever order devices sync in.
-- Attachments merge item by item: att_up = ids added/replaced (taken from
-- payload.attachments), att_rm = ids removed.
-- Older app versions send no `fields`: every field is claimed at the edit
-- time, so anything edited more recently elsewhere still wins, and their
-- attachment list can only add files.
-- Results carry the row's new `rev`; `foreign` = the row holds changes the
-- device hasn't seen (from elsewhere since its base_rev, or one of its own
-- fields lost to a newer edit), so it must pull the row rather than skip it
-- as its own echo. outcome 'rejected' = the id belongs to another account.
-- ------------------------------------------------------------
create or replace function public.sync_push(items jsonb)
returns jsonb
language plpgsql
security invoker
as $$
declare
  item jsonb;
  tbl text;
  rid uuid;
  p jsonb;
  edited_ms bigint;
  edited_ts timestamptz;
  existing_updated timestamptz;
  base_rev bigint;
  flds text[];
  fts jsonb;
  att_up text[];
  att_rm text[];
  win text[];
  ex_rev bigint;
  ex_ft jsonb;
  ex_goal uuid;
  new_goal uuid;
  new_rev bigint;
  results jsonb := '[]'::jsonb;
  affected_goals uuid[] := '{{}}';
  g uuid;
begin
  for item in select * from jsonb_array_elements(items)
  loop
    tbl := item->>'table';
    rid := (item->>'client_uuid')::uuid;
    p := item->'payload';
    edited_ms := (item->>'edited_at')::bigint;
    edited_ts := to_timestamp(edited_ms / 1000.0);
    base_rev := nullif(item->>'base_rev', '')::bigint;
    flds := case when jsonb_typeof(item->'fields') = 'array'
                 then array(select jsonb_array_elements_text(item->'fields')) else null end;
    fts := case when jsonb_typeof(item->'field_times') = 'object' then item->'field_times' else '{{}}'::jsonb end;
    att_up := array(select jsonb_array_elements_text(case when jsonb_typeof(item->'att_up') = 'array' then item->'att_up' else '[]'::jsonb end));
    att_rm := array(select jsonb_array_elements_text(case when jsonb_typeof(item->'att_rm') = 'array' then item->'att_rm' else '[]'::jsonb end));
    ex_goal := null; new_goal := null; new_rev := null; win := '{{}}';
    if flds is null then
      -- An older app version (sends whole records, no `fields`): treat it as
      -- changing every field at its edit time. The per-field times below
      -- then still protect anything edited more recently elsewhere, and its
      -- attachment list can only add files, never drop ones added elsewhere.
      flds := all_fields(tbl);
      att_up := array(select a->>'id' from jsonb_array_elements(case when jsonb_typeof(p->'attachments') = 'array' then p->'attachments' else '[]'::jsonb end) a);
      att_rm := '{{}}';
      base_rev := null;
    end if;
{branches}    end if;
  end loop;

  foreach g in array affected_goals loop
    perform public.recalc_goal(g);
  end loop;

  return jsonb_build_object('results', results);
end;
$$;"""


def all_fields_fn():
    cases = "\n".join("    when '%s' then array[%s]" % (k, ", ".join("'%s'" % f for f, _, _ in spec)) for k, _, spec in TABLES)
    return """-- Every synced field of a table (matches SYNC_FIELDS in frontend/src/sync/fields.ts).
create or replace function public.all_fields(tbl text)
returns text[]
language sql
immutable
as $$
  select case tbl
""" + cases + """
  end;
$$;
"""


def ddl():
    lines = []
    for _, table, _ in TABLES:
        lines.append(f"alter table public.{table} add column if not exists rev bigint not null default 1;")
        lines.append(f"alter table public.{table} add column if not exists field_times jsonb not null default '{{}}'::jsonb;")
        lines.append(f"alter table public.{table} add column if not exists txid xid8;")
        lines.append(f"create index if not exists {table}_user_txid_idx on public.{table} (user_id, txid);")
    trig = []
    for _, table, _ in TABLES:
        trig.append(f"drop trigger if exists bump_rev on public.{table};")
        trig.append(f"create trigger bump_rev before insert or update on public.{table}\n  for each row execute function public.bump_rev();")
    return """-- ------------------------------------------------------------
-- rev: bumped on every write (any device, the server's own goal roll-up),
-- so a device can tell whether a row changed since the copy it last saw.
-- field_times: per-field time of the last applied edit (ms since epoch) —
-- the clock for field-level merging in sync_push.
-- txid: the transaction that last wrote the row — what makes sync_pull's
-- cursor exact (see there).
-- ------------------------------------------------------------
""" + "\n".join(lines) + """

create or replace function public.bump_rev()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.rev := coalesce(old.rev, 0) + 1;
  end if;
  new.txid := pg_current_xact_id();
  return new;
end;
$$;
""" + "\n".join(trig) + """

""" + all_fields_fn() + """
-- Attachment lists merge by id: drop removed ids, replace updated items in
-- place, append new ones — so files added on two devices are both kept.
create or replace function public.merge_attachments(cur jsonb, up jsonb, rm text[])
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) from (
    select coalesce((select u from jsonb_array_elements(coalesce(up, '[]'::jsonb)) u
                     where u->>'id' = e->>'id' limit 1), e) as x, ord
      from jsonb_array_elements(coalesce(cur, '[]'::jsonb)) with ordinality as t(e, ord)
     where not ((e->>'id') = any(coalesce(rm, '{}')))
    union all
    select u, 1000000 + ord
      from jsonb_array_elements(coalesce(up, '[]'::jsonb)) with ordinality as t(u, ord)
     where not exists (select 1 from jsonb_array_elements(coalesce(cur, '[]'::jsonb)) e where e->>'id' = u->>'id')
  ) s;
$$;
"""


def sync_pull():
    branches = []
    for key, table, spec in TABLES:
        pairs = [f"'{f}', {c}" for f, c, _ in spec if f != 'deleted']
        data = ",\n          ".join(", ".join(pairs[i:i + 3]) for i in range(0, len(pairs), 3))
        branches.append(f"""      select jsonb_build_object(
        'table', '{key}', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
        'data', jsonb_build_object(
          {data},
          'rev', rev, 'updatedAt', (extract(epoch from coalesce(edited_at, updated_at)) * 1000)::bigint)) as rec
        from public.{table}
       where user_id = auth.uid()
         and (snap is null or (txid >= lo and not pg_visible_in_snapshot(txid, snap)))
         and (ts is null or updated_at > ts)
         and not ((id::text || '#' || rev) = any(skip))""")
    body = "\n      union all\n".join(branches)
    return f"""-- ------------------------------------------------------------
-- sync_pull — every row changed since the device's last pull, and the
-- cursor to send next time.
--
-- The cursor is the database snapshot this pull read from ("xmin:xmax:
-- xip,…"). Next time, rows written by any transaction that snapshot could
-- not see come back — including a save that was still committing while
-- this pull ran. (A timestamp cursor lost those for good: such a save is
-- stamped with its start time, earlier than the pull's, yet wasn't visible
-- to it.) Each row records the transaction that last wrote it in `txid`.
-- A timestamp cursor — older app versions, or the first pull after this
-- change — still works: rows changed since then, stepping back 2 minutes
-- for saves that were mid-commit (a statement can run up to 60s).
--
-- `skip`: "<id>#<rev>" of rows this device just pushed, so it doesn't
-- re-download its own save (a note full of images is MBs per autosave).
-- A key matches only that exact version — any later write bumps rev, so a
-- change from another device always comes through. (Older app versions
-- send "<id>:<ms>" keys; those match nothing now, so they re-download their
-- own saves — wasteful but always correct.)
-- updatedAt is epoch-milliseconds, like the app's Date.now() stamps.
-- ------------------------------------------------------------
drop function if exists public.sync_pull(timestamptz);
drop function if exists public.sync_pull(timestamptz, text[]);
create or replace function public.sync_pull(since text default null, skip text[] default '{{}}')
returns jsonb
language plpgsql
security invoker
as $$
declare
  snap pg_snapshot;  -- the previous pull's snapshot (the normal cursor)
  lo xid8;           -- …and the oldest transaction still running then
  ts timestamptz;    -- or a timestamp cursor
  res jsonb;
begin
  begin
    if since ~ '^\\d+:\\d+:' then
      snap := since::pg_snapshot;
      lo := pg_snapshot_xmin(snap);
    elsif coalesce(since, '') <> '' then
      ts := since::timestamptz - interval '2 minutes';
    end if;
  exception when others then
    -- an unreadable cursor: send everything rather than fail every sync
    snap := null; lo := null; ts := null;
  end;
  select jsonb_build_object(
      'cursor', pg_current_snapshot()::text,
      'records', coalesce(jsonb_agg(rec), '[]'::jsonb))
    into res
    from (
{body}
    ) all_records;
  return res;
end;
$$;"""


def apply(path):
    """Rewrite the generated blocks of schema.sql in place."""
    import re
    sql = open(path).read()
    blocks = [
        (r"-- -{60}\n-- rev: bumped on every write.*?\n  \) s;\n\$\$;\n", ddl()),
        (r"-- -{60}\n-- sync_push — items.*?\nend;\n\$\$;", sync_push()),
        (r"-- -{60}\n-- sync_pull — .*?\n\$\$;", sync_pull()),
    ]
    for pattern, text in blocks:
        new, n = re.subn(pattern, lambda _m: text, sql, count=1, flags=re.S)
        if n != 1:
            raise SystemExit(f"block not found in {path}: {pattern[:40]}")
        sql = new
    open(path, 'w').write(sql)


if __name__ == '__main__':
    import sys
    which = sys.argv[1]
    if which == 'apply':
        import os
        apply(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql'))
    else:
        print({'push': sync_push, 'pull': sync_pull, 'ddl': ddl}[which]())
