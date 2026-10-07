-- ============================================================
-- Planner — Supabase schema (project rleqtargnhpsojfpegtf)
-- Paste this whole file into the Supabase SQL Editor and Run.
-- Safe to re-run: every statement is guarded (IF NOT EXISTS / OR REPLACE /
-- DROP ... IF EXISTS before CREATE), so pasting it twice won't error.
--
-- Ports the ServiceNow backend 1:1: same table shapes, same field names
-- (camelCase in JSON payloads, snake_case as Postgres columns — exactly
-- mirroring servicenow/scripted-rest/sync_push.js and sync_pull.js's own
-- FIELD_MAPS), same last-write-wins conflict rule, same goal roll-up math.
-- The frontend's sync/engine.ts and every page are UNCHANGED by this
-- migration — only sync/api.ts's internals point here instead of SN, so
-- the JSON shapes below (client_uuid / sys_id / results / cursor+records)
-- are load-bearing: they match frontend/src/sync/api.ts's PushItem /
-- PushResult / PullResponse interfaces exactly, not a Postgres convention.
-- ============================================================

create extension if not exists citext;
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- profiles: username <-> auth.users(id). Login stays username-based (the
-- app has no email field) via a deterministic shadow email computed
-- client-side, lower(username) || '@users.planner.internal' — so
-- auth.users' own unique-email constraint IS the username-uniqueness
-- check, for free. This trigger creates the profile row atomically with
-- the auth user (more robust than a second client-side insert that could
-- fail after signup already succeeded).
-- ------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select using (user_id = auth.uid());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles for update using (user_id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  -- Shadow emails (lower(username) || '@planner-account.com') can never
  -- receive a real confirmation link, and this project has "confirm email"
  -- enabled with no dashboard toggle found to disable it project-wide — so
  -- every new signup confirms itself here instead, atomically with account
  -- creation. Standard, documented pattern for username-only auth on
  -- Supabase; safe specifically BECAUSE the email is never a real address
  -- a stranger could receive unwanted mail at.
  update auth.users set email_confirmed_at = now()
    where id = new.id and email_confirmed_at is null;

  insert into public.profiles (user_id, username, display_name)
  values (
    new.id,
    split_part(new.email, '@', 1),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- shared updated_at trigger — every synced table gets one, mirroring
-- ServiceNow's auto-maintained sys_updated_on (what the LWW check and
-- pull's cursor both key off of).
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- projects (created before tasks: tasks.project_id references it)
-- ------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  color text not null default 'coral',
  archived boolean not null default false,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;
drop policy if exists "own rows" on public.projects;
create policy "own rows" on public.projects for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop trigger if exists set_updated_at on public.projects;
create trigger set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- goals (self-referential; created before tasks: tasks.goal_id references it)
-- ------------------------------------------------------------
create table if not exists public.goals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  type text not null,
  parent_id uuid references public.goals(id) on delete set null,
  life_area text,
  why_it_matters text,
  progress int not null default 0,
  status text not null default 'not_started',
  target_date date,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.goals enable row level security;
drop policy if exists "own rows" on public.goals;
create policy "own rows" on public.goals for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop trigger if exists set_updated_at on public.goals;
create trigger set_updated_at before update on public.goals
  for each row execute function public.set_updated_at();
create index if not exists goals_parent_idx on public.goals (parent_id);

-- ------------------------------------------------------------
-- tasks
-- ------------------------------------------------------------
create table if not exists public.tasks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  state text not null default 'open',
  priority int not null default 3,
  due date,
  time_block_start timestamptz,
  time_block_end timestamptz,
  estimated_hours numeric,
  actual_hours numeric,
  goal_id uuid references public.goals(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  is_mit boolean not null default false,
  sort_order int,
  -- 0 is a real, active value ("remind me on the due day") — must stay
  -- distinguishable from "no reminder set" (null). sync_push() below is
  -- careful never to coalesce this to 0; this bit the ServiceNow version
  -- once already (generic INT_FIELDS coercion defaulted blank to 0).
  reminder_days_before int,
  recurrence text,
  series_id uuid,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.tasks enable row level security;
drop policy if exists "own rows" on public.tasks;
create policy "own rows" on public.tasks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop trigger if exists set_updated_at on public.tasks;
create trigger set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create index if not exists tasks_user_updated_idx on public.tasks (user_id, updated_at);
create index if not exists tasks_due_idx on public.tasks (user_id, due);
create index if not exists tasks_goal_idx on public.tasks (goal_id);
create index if not exists tasks_project_idx on public.tasks (project_id);
create index if not exists tasks_series_idx on public.tasks (series_id);

-- ------------------------------------------------------------
-- habits + habit_logs
-- ------------------------------------------------------------
create table if not exists public.habits (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  emoji text,
  frequency text not null default 'daily',
  target_per_day int not null default 1,
  active boolean not null default true,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.habits enable row level security;
drop policy if exists "own rows" on public.habits;
create policy "own rows" on public.habits for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop trigger if exists set_updated_at on public.habits;
create trigger set_updated_at before update on public.habits
  for each row execute function public.set_updated_at();

create table if not exists public.habit_logs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  habit_id uuid references public.habits(id) on delete cascade,
  date date not null,
  count int not null default 0,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.habit_logs enable row level security;
drop policy if exists "own rows" on public.habit_logs;
create policy "own rows" on public.habit_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop trigger if exists set_updated_at on public.habit_logs;
create trigger set_updated_at before update on public.habit_logs
  for each row execute function public.set_updated_at();
create index if not exists habit_logs_habit_date_idx on public.habit_logs (habit_id, date);

-- ------------------------------------------------------------
-- reviews
-- ------------------------------------------------------------
create table if not exists public.reviews (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  period_start date not null,
  period_end date not null,
  wins text,
  failures text,
  lesson text,
  mood text,
  energy int,
  next_priorities text,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
drop policy if exists "own rows" on public.reviews;
create policy "own rows" on public.reviews for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop trigger if exists set_updated_at on public.reviews;
create trigger set_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();
-- Screenshots/files attached to a review — same inline [{id,name,type,dataUrl}]
-- shape as drawings.attachments. Added after the table existed, hence the
-- separate idempotent ALTER instead of a column in the CREATE above.
alter table public.reviews add column if not exists attachments jsonb not null default '[]'::jsonb;

-- ------------------------------------------------------------
-- sketch_folders (created before drawings: drawings.folder_id references it)
-- ------------------------------------------------------------
create table if not exists public.sketch_folders (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.sketch_folders enable row level security;
drop policy if exists "own rows" on public.sketch_folders;
create policy "own rows" on public.sketch_folders for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop trigger if exists set_updated_at on public.sketch_folders;
create trigger set_updated_at before update on public.sketch_folders
  for each row execute function public.set_updated_at();
-- Notion-style cover banner on the folder page: an image data URL plus the
-- vertical focus point (0-100, CSS background-position-y %).
alter table public.sketch_folders add column if not exists cover text;
alter table public.sketch_folders add column if not exists cover_y int;
-- Banner height as a percentage of its width (null = default fixed height),
-- so it keeps the same shape on phone and desktop.
alter table public.sketch_folders add column if not exists cover_h real;
-- Folders can nest: the folder this one sits inside (null = top level).
alter table public.sketch_folders add column if not exists parent_id uuid
  references public.sketch_folders(id) on delete set null;

-- ------------------------------------------------------------
-- drawings (Sketches feature: hand-drawn or typed notes). Was local-only
-- under ServiceNow because its string fields cap out around 4000 chars and
-- a canvas PNG data URL runs far larger — Postgres text/jsonb columns have
-- no meaningful size ceiling, so that constraint is gone. sync_push/
-- sync_pull still move the WHOLE record on every change (no chunking),
-- same as every other table here — fine at personal-app scale, worth
-- knowing if sketches get much bigger.
-- ------------------------------------------------------------
create table if not exists public.drawings (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  kind text not null default 'draw',
  data_url text,
  text text,
  format text,
  attachments jsonb not null default '[]'::jsonb,
  folder_id uuid references public.sketch_folders(id) on delete set null,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.drawings enable row level security;
drop policy if exists "own rows" on public.drawings;
create policy "own rows" on public.drawings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop trigger if exists set_updated_at on public.drawings;
create trigger set_updated_at before update on public.drawings
  for each row execute function public.set_updated_at();
create index if not exists drawings_user_updated_idx on public.drawings (user_id, updated_at);
create index if not exists drawings_folder_idx on public.drawings (folder_id);

-- ------------------------------------------------------------
-- edited_at: when the change was made ON THE DEVICE (the client's edited_at).
-- Last-write-wins compares an incoming edit against this, not updated_at:
-- updated_at is the server's commit time, so a second quick edit made while
-- the first was still uploading looked "older" than the server copy and was
-- silently rejected (server_won) — a real lost-edit bug with auto-save and
-- attachments. updated_at stays the server clock for the pull cursor.
-- ------------------------------------------------------------
alter table public.tasks add column if not exists edited_at timestamptz;
alter table public.goals add column if not exists edited_at timestamptz;
alter table public.habits add column if not exists edited_at timestamptz;
alter table public.habit_logs add column if not exists edited_at timestamptz;
alter table public.reviews add column if not exists edited_at timestamptz;
alter table public.projects add column if not exists edited_at timestamptz;
alter table public.drawings add column if not exists edited_at timestamptz;
alter table public.sketch_folders add column if not exists edited_at timestamptz;

-- ------------------------------------------------------------
-- rev: bumped on every write (any device, the server's own goal roll-up),
-- so a device can tell whether a row changed since the copy it last saw.
-- field_times: per-field time of the last applied edit (ms since epoch) —
-- the clock for field-level merging in sync_push.
-- txid: the transaction that last wrote the row — what makes sync_pull's
-- cursor exact (see there).
-- ------------------------------------------------------------
alter table public.tasks add column if not exists rev bigint not null default 1;
alter table public.tasks add column if not exists field_times jsonb not null default '{}'::jsonb;
alter table public.tasks add column if not exists txid xid8;
create index if not exists tasks_user_txid_idx on public.tasks (user_id, txid);
alter table public.habits add column if not exists rev bigint not null default 1;
alter table public.habits add column if not exists field_times jsonb not null default '{}'::jsonb;
alter table public.habits add column if not exists txid xid8;
create index if not exists habits_user_txid_idx on public.habits (user_id, txid);
alter table public.habit_logs add column if not exists rev bigint not null default 1;
alter table public.habit_logs add column if not exists field_times jsonb not null default '{}'::jsonb;
alter table public.habit_logs add column if not exists txid xid8;
create index if not exists habit_logs_user_txid_idx on public.habit_logs (user_id, txid);
alter table public.goals add column if not exists rev bigint not null default 1;
alter table public.goals add column if not exists field_times jsonb not null default '{}'::jsonb;
alter table public.goals add column if not exists txid xid8;
create index if not exists goals_user_txid_idx on public.goals (user_id, txid);
alter table public.reviews add column if not exists rev bigint not null default 1;
alter table public.reviews add column if not exists field_times jsonb not null default '{}'::jsonb;
alter table public.reviews add column if not exists txid xid8;
create index if not exists reviews_user_txid_idx on public.reviews (user_id, txid);
alter table public.projects add column if not exists rev bigint not null default 1;
alter table public.projects add column if not exists field_times jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists txid xid8;
create index if not exists projects_user_txid_idx on public.projects (user_id, txid);
alter table public.drawings add column if not exists rev bigint not null default 1;
alter table public.drawings add column if not exists field_times jsonb not null default '{}'::jsonb;
alter table public.drawings add column if not exists txid xid8;
create index if not exists drawings_user_txid_idx on public.drawings (user_id, txid);
alter table public.sketch_folders add column if not exists rev bigint not null default 1;
alter table public.sketch_folders add column if not exists field_times jsonb not null default '{}'::jsonb;
alter table public.sketch_folders add column if not exists txid xid8;
create index if not exists sketch_folders_user_txid_idx on public.sketch_folders (user_id, txid);

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
drop trigger if exists bump_rev on public.tasks;
create trigger bump_rev before insert or update on public.tasks
  for each row execute function public.bump_rev();
drop trigger if exists bump_rev on public.habits;
create trigger bump_rev before insert or update on public.habits
  for each row execute function public.bump_rev();
drop trigger if exists bump_rev on public.habit_logs;
create trigger bump_rev before insert or update on public.habit_logs
  for each row execute function public.bump_rev();
drop trigger if exists bump_rev on public.goals;
create trigger bump_rev before insert or update on public.goals
  for each row execute function public.bump_rev();
drop trigger if exists bump_rev on public.reviews;
create trigger bump_rev before insert or update on public.reviews
  for each row execute function public.bump_rev();
drop trigger if exists bump_rev on public.projects;
create trigger bump_rev before insert or update on public.projects
  for each row execute function public.bump_rev();
drop trigger if exists bump_rev on public.drawings;
create trigger bump_rev before insert or update on public.drawings
  for each row execute function public.bump_rev();
drop trigger if exists bump_rev on public.sketch_folders;
create trigger bump_rev before insert or update on public.sketch_folders
  for each row execute function public.bump_rev();

-- Every synced field of a table (matches SYNC_FIELDS in frontend/src/sync/fields.ts).
create or replace function public.all_fields(tbl text)
returns text[]
language sql
immutable
as $$
  select case tbl
    when 'task' then array['title', 'notes', 'state', 'priority', 'due', 'timeBlockStart', 'timeBlockEnd', 'estimatedHours', 'actualHours', 'goalId', 'projectId', 'isMit', 'sortOrder', 'reminderDaysBefore', 'recurrence', 'seriesId', 'deleted']
    when 'habit' then array['name', 'emoji', 'frequency', 'targetPerDay', 'active', 'deleted']
    when 'habit_log' then array['habitId', 'date', 'count', 'deleted']
    when 'goal' then array['title', 'type', 'parentId', 'lifeArea', 'whyItMatters', 'progress', 'status', 'targetDate', 'deleted']
    when 'review' then array['type', 'periodStart', 'periodEnd', 'wins', 'failures', 'lesson', 'mood', 'energy', 'nextPriorities', 'attachments', 'deleted']
    when 'project' then array['title', 'color', 'archived', 'deleted']
    when 'drawing' then array['title', 'kind', 'dataUrl', 'text', 'format', 'attachments', 'folderId', 'deleted']
    when 'folder' then array['name', 'parentId', 'cover', 'coverY', 'coverH', 'deleted']
  end;
$$;

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

-- ------------------------------------------------------------
-- recalc_goal — recompute a goal's progress, then every ancestor's.
-- Mirrors rollUpGoal in frontend/src/db/db.ts; keep the two in step.
-- Any level can have tasks linked directly, so a goal's progress is the
-- average of its parts: each non-deleted child goal is one part, and all
-- its directly linked (non-deleted, non-cancelled) tasks together are one
-- more part (done / total). A goal with no parts keeps its manually set
-- progress — no tasks never means done. The only automatic status change is
-- not_started -> in_progress once there's progress. Completed (and at_risk /
-- abandoned) are the user's call and never touched: 100% only means every
-- task added so far is done, and more may come.
-- ------------------------------------------------------------
create or replace function public.recalc_goal(p_goal_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  v_owner uuid;
  v_id uuid;
  v_sum numeric;
  v_parts int;
  v_total int;
  v_done int;
  v_pct int;
  depth int := 0;
begin
  select user_id into v_owner from public.goals where id = p_goal_id;
  if v_owner is null or v_owner <> auth.uid() then
    return;
  end if;

  v_id := p_goal_id;
  while v_id is not null and depth < 11 loop
    select coalesce(sum(progress), 0), count(*)
      into v_sum, v_parts
      from public.goals
      where parent_id = v_id and deleted = false;

    select count(*), count(*) filter (where state = 'done')
      into v_total, v_done
      from public.tasks
      where goal_id = v_id and deleted = false and state <> 'cancelled';

    if v_total > 0 then
      v_sum := v_sum + v_done::numeric / v_total * 100;
      v_parts := v_parts + 1;
    end if;

    if v_parts > 0 then
      v_pct := round(v_sum / v_parts);
      update public.goals set
        edited_at = now(),
        progress = v_pct,
        status = case when v_pct > 0 and status = 'not_started' then 'in_progress' else status end
      where id = v_id;
    end if;

    select parent_id into v_id from public.goals where id = v_id;
    depth := depth + 1;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- sync_push — items: jsonb array of
--   {table, client_uuid, payload, edited_at, base_rev, fields, field_times, att_up, att_rm}
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
  affected_goals uuid[] := '{}';
  g uuid;
begin
  -- no account (a request without a sign-in token): refuse, never "apply"
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
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
    fts := case when jsonb_typeof(item->'field_times') = 'object' then item->'field_times' else '{}'::jsonb end;
    att_up := array(select jsonb_array_elements_text(case when jsonb_typeof(item->'att_up') = 'array' then item->'att_up' else '[]'::jsonb end));
    att_rm := array(select jsonb_array_elements_text(case when jsonb_typeof(item->'att_rm') = 'array' then item->'att_rm' else '[]'::jsonb end));
    ex_goal := null; new_goal := null; new_rev := null; win := '{}';
    if flds is null then
      -- An older app version (sends whole records, no `fields`): treat it as
      -- changing every field at its edit time. The per-field times below
      -- then still protect anything edited more recently elsewhere, and its
      -- attachment list can only add files, never drop ones added elsewhere.
      flds := all_fields(tbl);
      att_up := array(select a->>'id' from jsonb_array_elements(case when jsonb_typeof(p->'attachments') = 'array' then p->'attachments' else '[]'::jsonb end) a);
      att_rm := '{}';
      base_rev := null;
    end if;

    if tbl = 'task' then
      select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz), goal_id
        into ex_rev, ex_ft, existing_updated, ex_goal
        from public.tasks where id = rid and user_id = auth.uid() for update;
      if not found then
        -- new record: insert every column, but stamp edit times only on the
        -- fields this device actually filled — an empty field it never wrote
        -- must not outrank another device's earlier edit of that field
        insert into public.tasks (id, user_id, edited_at, field_times, title, notes, state, priority, due, time_block_start, time_block_end, estimated_hours, actual_hours, goal_id, project_id, is_mit, sort_order, reminder_days_before, recurrence, series_id, deleted)
        values (rid, auth.uid(), edited_ts,
            coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(flds) f), '{}'::jsonb),
            coalesce(nullif(p->>'title', ''), ''),
            nullif(p->>'notes', ''),
            coalesce(nullif(p->>'state', ''), 'open'),
            coalesce(nullif(p->>'priority', '')::int, 3),
            nullif(p->>'due', '')::date,
            nullif(p->>'timeBlockStart', '')::timestamptz,
            nullif(p->>'timeBlockEnd', '')::timestamptz,
            nullif(p->>'estimatedHours', '')::numeric,
            nullif(p->>'actualHours', '')::numeric,
            nullif(p->>'goalId', '')::uuid,
            nullif(p->>'projectId', '')::uuid,
            coalesce(nullif(p->>'isMit', '')::boolean, false),
            nullif(p->>'sortOrder', '')::int,
            nullif(p->>'reminderDaysBefore', '')::int,
            nullif(p->>'recurrence', ''),
            nullif(p->>'seriesId', '')::uuid,
            coalesce(nullif(p->>'deleted', '')::boolean, false))
        on conflict (id) do nothing
        returning rev, goal_id into new_rev, new_goal;
        if new_rev is not null then
          results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied', 'rev', new_rev, 'foreign', false);
        if new_goal is not null then affected_goals := affected_goals || new_goal; end if;
        if ex_goal is not null and ex_goal is distinct from new_goal then affected_goals := affected_goals || ex_goal; end if;
        else
          -- another device created this same record (same id: a day's
          -- review, a habit's day) between the lookup above and this
          -- insert — merge into it below rather than drop this one
          select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz), goal_id
            into ex_rev, ex_ft, existing_updated, ex_goal
            from public.tasks where id = rid and user_id = auth.uid() for update;
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
        update public.tasks set
            title = case when 'title' = any(win) then coalesce(nullif(p->>'title', ''), '') else title end,
            notes = case when 'notes' = any(win) then nullif(p->>'notes', '') else notes end,
            state = case when 'state' = any(win) then coalesce(nullif(p->>'state', ''), 'open') else state end,
            priority = case when 'priority' = any(win) then coalesce(nullif(p->>'priority', '')::int, 3) else priority end,
            due = case when 'due' = any(win) then nullif(p->>'due', '')::date else due end,
            time_block_start = case when 'timeBlockStart' = any(win) then nullif(p->>'timeBlockStart', '')::timestamptz else time_block_start end,
            time_block_end = case when 'timeBlockEnd' = any(win) then nullif(p->>'timeBlockEnd', '')::timestamptz else time_block_end end,
            estimated_hours = case when 'estimatedHours' = any(win) then nullif(p->>'estimatedHours', '')::numeric else estimated_hours end,
            actual_hours = case when 'actualHours' = any(win) then nullif(p->>'actualHours', '')::numeric else actual_hours end,
            goal_id = case when 'goalId' = any(win) then nullif(p->>'goalId', '')::uuid else goal_id end,
            project_id = case when 'projectId' = any(win) then nullif(p->>'projectId', '')::uuid else project_id end,
            is_mit = case when 'isMit' = any(win) then coalesce(nullif(p->>'isMit', '')::boolean, false) else is_mit end,
            sort_order = case when 'sortOrder' = any(win) then nullif(p->>'sortOrder', '')::int else sort_order end,
            reminder_days_before = case when 'reminderDaysBefore' = any(win) then nullif(p->>'reminderDaysBefore', '')::int else reminder_days_before end,
            recurrence = case when 'recurrence' = any(win) then nullif(p->>'recurrence', '') else recurrence end,
            series_id = case when 'seriesId' = any(win) then nullif(p->>'seriesId', '')::uuid else series_id end,
            deleted = case when 'deleted' = any(win) then coalesce(nullif(p->>'deleted', '')::boolean, false) else deleted end,
            field_times = ex_ft || coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(win) f), '{}'::jsonb),
            edited_at = greatest(existing_updated, edited_ts)
          where id = rid and user_id = auth.uid()
          returning rev, goal_id into new_rev, new_goal;
        -- foreign: the row holds something this device hasn't seen — changes
        -- from elsewhere since its base, or one of its own fields lost to a
        -- newer edit — so it must pull the row instead of skipping its echo
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied',
          'rev', new_rev, 'foreign', ex_rev is distinct from base_rev
            or coalesce(array_length(win, 1), 0) < coalesce(array_length(flds, 1), 0));
        if win && array['goalId', 'state', 'deleted'] then
          if ex_goal is not null then affected_goals := affected_goals || ex_goal; end if;
          if new_goal is not null then affected_goals := affected_goals || new_goal; end if;
        end if;
      end if;

    elsif tbl = 'habit' then
      select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
        into ex_rev, ex_ft, existing_updated
        from public.habits where id = rid and user_id = auth.uid() for update;
      if not found then
        -- new record: insert every column, but stamp edit times only on the
        -- fields this device actually filled — an empty field it never wrote
        -- must not outrank another device's earlier edit of that field
        insert into public.habits (id, user_id, edited_at, field_times, name, emoji, frequency, target_per_day, active, deleted)
        values (rid, auth.uid(), edited_ts,
            coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(flds) f), '{}'::jsonb),
            coalesce(nullif(p->>'name', ''), ''),
            nullif(p->>'emoji', ''),
            coalesce(nullif(p->>'frequency', ''), 'daily'),
            coalesce(nullif(p->>'targetPerDay', '')::int, 1),
            coalesce(nullif(p->>'active', '')::boolean, true),
            coalesce(nullif(p->>'deleted', '')::boolean, false))
        on conflict (id) do nothing
        returning rev into new_rev;
        if new_rev is not null then
          results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied', 'rev', new_rev, 'foreign', false);
        else
          -- another device created this same record (same id: a day's
          -- review, a habit's day) between the lookup above and this
          -- insert — merge into it below rather than drop this one
          select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
            into ex_rev, ex_ft, existing_updated
            from public.habits where id = rid and user_id = auth.uid() for update;
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
        update public.habits set
            name = case when 'name' = any(win) then coalesce(nullif(p->>'name', ''), '') else name end,
            emoji = case when 'emoji' = any(win) then nullif(p->>'emoji', '') else emoji end,
            frequency = case when 'frequency' = any(win) then coalesce(nullif(p->>'frequency', ''), 'daily') else frequency end,
            target_per_day = case when 'targetPerDay' = any(win) then coalesce(nullif(p->>'targetPerDay', '')::int, 1) else target_per_day end,
            active = case when 'active' = any(win) then coalesce(nullif(p->>'active', '')::boolean, true) else active end,
            deleted = case when 'deleted' = any(win) then coalesce(nullif(p->>'deleted', '')::boolean, false) else deleted end,
            field_times = ex_ft || coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(win) f), '{}'::jsonb),
            edited_at = greatest(existing_updated, edited_ts)
          where id = rid and user_id = auth.uid()
          returning rev into new_rev;
        -- foreign: the row holds something this device hasn't seen — changes
        -- from elsewhere since its base, or one of its own fields lost to a
        -- newer edit — so it must pull the row instead of skipping its echo
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied',
          'rev', new_rev, 'foreign', ex_rev is distinct from base_rev
            or coalesce(array_length(win, 1), 0) < coalesce(array_length(flds, 1), 0));
      end if;

    elsif tbl = 'habit_log' then
      select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
        into ex_rev, ex_ft, existing_updated
        from public.habit_logs where id = rid and user_id = auth.uid() for update;
      if not found then
        -- new record: insert every column, but stamp edit times only on the
        -- fields this device actually filled — an empty field it never wrote
        -- must not outrank another device's earlier edit of that field
        insert into public.habit_logs (id, user_id, edited_at, field_times, habit_id, date, count, deleted)
        values (rid, auth.uid(), edited_ts,
            coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(flds) f), '{}'::jsonb),
            nullif(p->>'habitId', '')::uuid,
            nullif(p->>'date', '')::date,
            coalesce(nullif(p->>'count', '')::int, 0),
            coalesce(nullif(p->>'deleted', '')::boolean, false))
        on conflict (id) do nothing
        returning rev into new_rev;
        if new_rev is not null then
          results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied', 'rev', new_rev, 'foreign', false);
        else
          -- another device created this same record (same id: a day's
          -- review, a habit's day) between the lookup above and this
          -- insert — merge into it below rather than drop this one
          select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
            into ex_rev, ex_ft, existing_updated
            from public.habit_logs where id = rid and user_id = auth.uid() for update;
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
        update public.habit_logs set
            habit_id = case when 'habitId' = any(win) then nullif(p->>'habitId', '')::uuid else habit_id end,
            date = case when 'date' = any(win) then nullif(p->>'date', '')::date else date end,
            count = case when 'count' = any(win) then coalesce(nullif(p->>'count', '')::int, 0) else count end,
            deleted = case when 'deleted' = any(win) then coalesce(nullif(p->>'deleted', '')::boolean, false) else deleted end,
            field_times = ex_ft || coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(win) f), '{}'::jsonb),
            edited_at = greatest(existing_updated, edited_ts)
          where id = rid and user_id = auth.uid()
          returning rev into new_rev;
        -- foreign: the row holds something this device hasn't seen — changes
        -- from elsewhere since its base, or one of its own fields lost to a
        -- newer edit — so it must pull the row instead of skipping its echo
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied',
          'rev', new_rev, 'foreign', ex_rev is distinct from base_rev
            or coalesce(array_length(win, 1), 0) < coalesce(array_length(flds, 1), 0));
      end if;

    elsif tbl = 'goal' then
      select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
        into ex_rev, ex_ft, existing_updated
        from public.goals where id = rid and user_id = auth.uid() for update;
      if not found then
        -- new record: insert every column, but stamp edit times only on the
        -- fields this device actually filled — an empty field it never wrote
        -- must not outrank another device's earlier edit of that field
        insert into public.goals (id, user_id, edited_at, field_times, title, type, parent_id, life_area, why_it_matters, progress, status, target_date, deleted)
        values (rid, auth.uid(), edited_ts,
            coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(flds) f), '{}'::jsonb),
            coalesce(nullif(p->>'title', ''), ''),
            coalesce(nullif(p->>'type', ''), 'week'),
            nullif(p->>'parentId', '')::uuid,
            nullif(p->>'lifeArea', ''),
            nullif(p->>'whyItMatters', ''),
            coalesce(nullif(p->>'progress', '')::int, 0),
            coalesce(nullif(p->>'status', ''), 'not_started'),
            nullif(p->>'targetDate', '')::date,
            coalesce(nullif(p->>'deleted', '')::boolean, false))
        on conflict (id) do nothing
        returning rev into new_rev;
        if new_rev is not null then
          results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied', 'rev', new_rev, 'foreign', false);
        affected_goals := affected_goals || rid;
        else
          -- another device created this same record (same id: a day's
          -- review, a habit's day) between the lookup above and this
          -- insert — merge into it below rather than drop this one
          select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
            into ex_rev, ex_ft, existing_updated
            from public.goals where id = rid and user_id = auth.uid() for update;
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
        update public.goals set
            title = case when 'title' = any(win) then coalesce(nullif(p->>'title', ''), '') else title end,
            type = case when 'type' = any(win) then coalesce(nullif(p->>'type', ''), 'week') else type end,
            parent_id = case when 'parentId' = any(win) then nullif(p->>'parentId', '')::uuid else parent_id end,
            life_area = case when 'lifeArea' = any(win) then nullif(p->>'lifeArea', '') else life_area end,
            why_it_matters = case when 'whyItMatters' = any(win) then nullif(p->>'whyItMatters', '') else why_it_matters end,
            progress = case when 'progress' = any(win) then coalesce(nullif(p->>'progress', '')::int, 0) else progress end,
            status = case when 'status' = any(win) then coalesce(nullif(p->>'status', ''), 'not_started') else status end,
            target_date = case when 'targetDate' = any(win) then nullif(p->>'targetDate', '')::date else target_date end,
            deleted = case when 'deleted' = any(win) then coalesce(nullif(p->>'deleted', '')::boolean, false) else deleted end,
            field_times = ex_ft || coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(win) f), '{}'::jsonb),
            edited_at = greatest(existing_updated, edited_ts)
          where id = rid and user_id = auth.uid()
          returning rev into new_rev;
        -- foreign: the row holds something this device hasn't seen — changes
        -- from elsewhere since its base, or one of its own fields lost to a
        -- newer edit — so it must pull the row instead of skipping its echo
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied',
          'rev', new_rev, 'foreign', ex_rev is distinct from base_rev
            or coalesce(array_length(win, 1), 0) < coalesce(array_length(flds, 1), 0));
        affected_goals := affected_goals || rid;
      end if;

    elsif tbl = 'review' then
      select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
        into ex_rev, ex_ft, existing_updated
        from public.reviews where id = rid and user_id = auth.uid() for update;
      if not found then
        -- new record: insert every column, but stamp edit times only on the
        -- fields this device actually filled — an empty field it never wrote
        -- must not outrank another device's earlier edit of that field
        insert into public.reviews (id, user_id, edited_at, field_times, type, period_start, period_end, wins, failures, lesson, mood, energy, next_priorities, attachments, deleted)
        values (rid, auth.uid(), edited_ts,
            coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(flds) f), '{}'::jsonb),
            coalesce(nullif(p->>'type', ''), 'daily'),
            nullif(p->>'periodStart', '')::date,
            nullif(p->>'periodEnd', '')::date,
            nullif(p->>'wins', ''),
            nullif(p->>'failures', ''),
            nullif(p->>'lesson', ''),
            nullif(p->>'mood', ''),
            nullif(p->>'energy', '')::int,
            nullif(p->>'nextPriorities', ''),
            case when jsonb_typeof(p->'attachments') = 'array' then p->'attachments' else '[]'::jsonb end,
            coalesce(nullif(p->>'deleted', '')::boolean, false))
        on conflict (id) do nothing
        returning rev into new_rev;
        if new_rev is not null then
          results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied', 'rev', new_rev, 'foreign', false);
        else
          -- another device created this same record (same id: a day's
          -- review, a habit's day) between the lookup above and this
          -- insert — merge into it below rather than drop this one
          select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
            into ex_rev, ex_ft, existing_updated
            from public.reviews where id = rid and user_id = auth.uid() for update;
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
        update public.reviews set
            type = case when 'type' = any(win) then coalesce(nullif(p->>'type', ''), 'daily') else type end,
            period_start = case when 'periodStart' = any(win) then nullif(p->>'periodStart', '')::date else period_start end,
            period_end = case when 'periodEnd' = any(win) then nullif(p->>'periodEnd', '')::date else period_end end,
            wins = case when 'wins' = any(win) then nullif(p->>'wins', '') else wins end,
            failures = case when 'failures' = any(win) then nullif(p->>'failures', '') else failures end,
            lesson = case when 'lesson' = any(win) then nullif(p->>'lesson', '') else lesson end,
            mood = case when 'mood' = any(win) then nullif(p->>'mood', '') else mood end,
            energy = case when 'energy' = any(win) then nullif(p->>'energy', '')::int else energy end,
            next_priorities = case when 'nextPriorities' = any(win) then nullif(p->>'nextPriorities', '') else next_priorities end,
            attachments = case when 'attachments' = any(flds) then public.merge_attachments(attachments,
              (select coalesce(jsonb_agg(a), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(p->'attachments') = 'array' then p->'attachments' else '[]'::jsonb end) a where a->>'id' = any(att_up)),
              att_rm) else attachments end,
            deleted = case when 'deleted' = any(win) then coalesce(nullif(p->>'deleted', '')::boolean, false) else deleted end,
            field_times = ex_ft || coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(win) f), '{}'::jsonb),
            edited_at = greatest(existing_updated, edited_ts)
          where id = rid and user_id = auth.uid()
          returning rev into new_rev;
        -- foreign: the row holds something this device hasn't seen — changes
        -- from elsewhere since its base, or one of its own fields lost to a
        -- newer edit — so it must pull the row instead of skipping its echo
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied',
          'rev', new_rev, 'foreign', ex_rev is distinct from base_rev
            or coalesce(array_length(win, 1), 0) < coalesce(array_length(flds, 1), 0));
      end if;

    elsif tbl = 'project' then
      select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
        into ex_rev, ex_ft, existing_updated
        from public.projects where id = rid and user_id = auth.uid() for update;
      if not found then
        -- new record: insert every column, but stamp edit times only on the
        -- fields this device actually filled — an empty field it never wrote
        -- must not outrank another device's earlier edit of that field
        insert into public.projects (id, user_id, edited_at, field_times, title, color, archived, deleted)
        values (rid, auth.uid(), edited_ts,
            coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(flds) f), '{}'::jsonb),
            coalesce(nullif(p->>'title', ''), ''),
            coalesce(nullif(p->>'color', ''), 'coral'),
            coalesce(nullif(p->>'archived', '')::boolean, false),
            coalesce(nullif(p->>'deleted', '')::boolean, false))
        on conflict (id) do nothing
        returning rev into new_rev;
        if new_rev is not null then
          results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied', 'rev', new_rev, 'foreign', false);
        else
          -- another device created this same record (same id: a day's
          -- review, a habit's day) between the lookup above and this
          -- insert — merge into it below rather than drop this one
          select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
            into ex_rev, ex_ft, existing_updated
            from public.projects where id = rid and user_id = auth.uid() for update;
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
        update public.projects set
            title = case when 'title' = any(win) then coalesce(nullif(p->>'title', ''), '') else title end,
            color = case when 'color' = any(win) then coalesce(nullif(p->>'color', ''), 'coral') else color end,
            archived = case when 'archived' = any(win) then coalesce(nullif(p->>'archived', '')::boolean, false) else archived end,
            deleted = case when 'deleted' = any(win) then coalesce(nullif(p->>'deleted', '')::boolean, false) else deleted end,
            field_times = ex_ft || coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(win) f), '{}'::jsonb),
            edited_at = greatest(existing_updated, edited_ts)
          where id = rid and user_id = auth.uid()
          returning rev into new_rev;
        -- foreign: the row holds something this device hasn't seen — changes
        -- from elsewhere since its base, or one of its own fields lost to a
        -- newer edit — so it must pull the row instead of skipping its echo
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied',
          'rev', new_rev, 'foreign', ex_rev is distinct from base_rev
            or coalesce(array_length(win, 1), 0) < coalesce(array_length(flds, 1), 0));
      end if;

    elsif tbl = 'drawing' then
      select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
        into ex_rev, ex_ft, existing_updated
        from public.drawings where id = rid and user_id = auth.uid() for update;
      if not found then
        -- new record: insert every column, but stamp edit times only on the
        -- fields this device actually filled — an empty field it never wrote
        -- must not outrank another device's earlier edit of that field
        insert into public.drawings (id, user_id, edited_at, field_times, title, kind, data_url, text, format, attachments, folder_id, deleted)
        values (rid, auth.uid(), edited_ts,
            coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(flds) f), '{}'::jsonb),
            coalesce(nullif(p->>'title', ''), ''),
            coalesce(nullif(p->>'kind', ''), 'draw'),
            nullif(p->>'dataUrl', ''),
            nullif(p->>'text', ''),
            nullif(p->>'format', ''),
            case when jsonb_typeof(p->'attachments') = 'array' then p->'attachments' else '[]'::jsonb end,
            nullif(p->>'folderId', '')::uuid,
            coalesce(nullif(p->>'deleted', '')::boolean, false))
        on conflict (id) do nothing
        returning rev into new_rev;
        if new_rev is not null then
          results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied', 'rev', new_rev, 'foreign', false);
        else
          -- another device created this same record (same id: a day's
          -- review, a habit's day) between the lookup above and this
          -- insert — merge into it below rather than drop this one
          select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
            into ex_rev, ex_ft, existing_updated
            from public.drawings where id = rid and user_id = auth.uid() for update;
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
        update public.drawings set
            title = case when 'title' = any(win) then coalesce(nullif(p->>'title', ''), '') else title end,
            kind = case when 'kind' = any(win) then coalesce(nullif(p->>'kind', ''), 'draw') else kind end,
            data_url = case when 'dataUrl' = any(win) then nullif(p->>'dataUrl', '') else data_url end,
            text = case when 'text' = any(win) then nullif(p->>'text', '') else text end,
            format = case when 'format' = any(win) then nullif(p->>'format', '') else format end,
            attachments = case when 'attachments' = any(flds) then public.merge_attachments(attachments,
              (select coalesce(jsonb_agg(a), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(p->'attachments') = 'array' then p->'attachments' else '[]'::jsonb end) a where a->>'id' = any(att_up)),
              att_rm) else attachments end,
            folder_id = case when 'folderId' = any(win) then nullif(p->>'folderId', '')::uuid else folder_id end,
            deleted = case when 'deleted' = any(win) then coalesce(nullif(p->>'deleted', '')::boolean, false) else deleted end,
            field_times = ex_ft || coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(win) f), '{}'::jsonb),
            edited_at = greatest(existing_updated, edited_ts)
          where id = rid and user_id = auth.uid()
          returning rev into new_rev;
        -- foreign: the row holds something this device hasn't seen — changes
        -- from elsewhere since its base, or one of its own fields lost to a
        -- newer edit — so it must pull the row instead of skipping its echo
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied',
          'rev', new_rev, 'foreign', ex_rev is distinct from base_rev
            or coalesce(array_length(win, 1), 0) < coalesce(array_length(flds, 1), 0));
      end if;

    elsif tbl = 'folder' then
      select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
        into ex_rev, ex_ft, existing_updated
        from public.sketch_folders where id = rid and user_id = auth.uid() for update;
      if not found then
        -- new record: insert every column, but stamp edit times only on the
        -- fields this device actually filled — an empty field it never wrote
        -- must not outrank another device's earlier edit of that field
        insert into public.sketch_folders (id, user_id, edited_at, field_times, name, parent_id, cover, cover_y, cover_h, deleted)
        values (rid, auth.uid(), edited_ts,
            coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(flds) f), '{}'::jsonb),
            coalesce(nullif(p->>'name', ''), ''),
            nullif(p->>'parentId', '')::uuid,
            nullif(p->>'cover', ''),
            nullif(p->>'coverY', '')::int,
            nullif(p->>'coverH', '')::real,
            coalesce(nullif(p->>'deleted', '')::boolean, false))
        on conflict (id) do nothing
        returning rev into new_rev;
        if new_rev is not null then
          results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied', 'rev', new_rev, 'foreign', false);
        else
          -- another device created this same record (same id: a day's
          -- review, a habit's day) between the lookup above and this
          -- insert — merge into it below rather than drop this one
          select rev, coalesce(field_times, '{}'::jsonb), coalesce(edited_at, '-infinity'::timestamptz)
            into ex_rev, ex_ft, existing_updated
            from public.sketch_folders where id = rid and user_id = auth.uid() for update;
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
        update public.sketch_folders set
            name = case when 'name' = any(win) then coalesce(nullif(p->>'name', ''), '') else name end,
            parent_id = case when 'parentId' = any(win) then nullif(p->>'parentId', '')::uuid else parent_id end,
            cover = case when 'cover' = any(win) then nullif(p->>'cover', '') else cover end,
            cover_y = case when 'coverY' = any(win) then nullif(p->>'coverY', '')::int else cover_y end,
            cover_h = case when 'coverH' = any(win) then nullif(p->>'coverH', '')::real else cover_h end,
            deleted = case when 'deleted' = any(win) then coalesce(nullif(p->>'deleted', '')::boolean, false) else deleted end,
            field_times = ex_ft || coalesce((select jsonb_object_agg(f, coalesce((fts->>f)::bigint, edited_ms)) from unnest(win) f), '{}'::jsonb),
            edited_at = greatest(existing_updated, edited_ts)
          where id = rid and user_id = auth.uid()
          returning rev into new_rev;
        -- foreign: the row holds something this device hasn't seen — changes
        -- from elsewhere since its base, or one of its own fields lost to a
        -- newer edit — so it must pull the row instead of skipping its echo
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied',
          'rev', new_rev, 'foreign', ex_rev is distinct from base_rev
            or coalesce(array_length(win, 1), 0) < coalesce(array_length(flds, 1), 0));
      end if;
    end if;
  end loop;

  foreach g in array affected_goals loop
    perform public.recalc_goal(g);
  end loop;

  return jsonb_build_object('results', results);
end;
$$;

-- ------------------------------------------------------------
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
create or replace function public.sync_pull(since text default null, skip text[] default '{}')
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
  -- No account: refuse. Answering "nothing changed" with a fresh cursor made
  -- a device whose sign-in was being refreshed skip every change made
  -- elsewhere in the meantime — for good.
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  begin
    if since ~ '^\d+:\d+:' then
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
      select jsonb_build_object(
        'table', 'task', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
        'data', jsonb_build_object(
          'title', title, 'notes', notes, 'state', state,
          'priority', priority, 'due', due, 'timeBlockStart', time_block_start,
          'timeBlockEnd', time_block_end, 'estimatedHours', estimated_hours, 'actualHours', actual_hours,
          'goalId', goal_id, 'projectId', project_id, 'isMit', is_mit,
          'sortOrder', sort_order, 'reminderDaysBefore', reminder_days_before, 'recurrence', recurrence,
          'seriesId', series_id,
          'rev', rev, 'updatedAt', (extract(epoch from coalesce(edited_at, updated_at)) * 1000)::bigint)) as rec
        from public.tasks
       where user_id = auth.uid()
         and (snap is null or (txid >= lo and not pg_visible_in_snapshot(txid, snap)))
         and (ts is null or updated_at > ts)
         and not ((id::text || '#' || rev) = any(skip))
      union all
      select jsonb_build_object(
        'table', 'habit', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
        'data', jsonb_build_object(
          'name', name, 'emoji', emoji, 'frequency', frequency,
          'targetPerDay', target_per_day, 'active', active,
          'rev', rev, 'updatedAt', (extract(epoch from coalesce(edited_at, updated_at)) * 1000)::bigint)) as rec
        from public.habits
       where user_id = auth.uid()
         and (snap is null or (txid >= lo and not pg_visible_in_snapshot(txid, snap)))
         and (ts is null or updated_at > ts)
         and not ((id::text || '#' || rev) = any(skip))
      union all
      select jsonb_build_object(
        'table', 'habit_log', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
        'data', jsonb_build_object(
          'habitId', habit_id, 'date', date, 'count', count,
          'rev', rev, 'updatedAt', (extract(epoch from coalesce(edited_at, updated_at)) * 1000)::bigint)) as rec
        from public.habit_logs
       where user_id = auth.uid()
         and (snap is null or (txid >= lo and not pg_visible_in_snapshot(txid, snap)))
         and (ts is null or updated_at > ts)
         and not ((id::text || '#' || rev) = any(skip))
      union all
      select jsonb_build_object(
        'table', 'goal', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
        'data', jsonb_build_object(
          'title', title, 'type', type, 'parentId', parent_id,
          'lifeArea', life_area, 'whyItMatters', why_it_matters, 'progress', progress,
          'status', status, 'targetDate', target_date,
          'rev', rev, 'updatedAt', (extract(epoch from coalesce(edited_at, updated_at)) * 1000)::bigint)) as rec
        from public.goals
       where user_id = auth.uid()
         and (snap is null or (txid >= lo and not pg_visible_in_snapshot(txid, snap)))
         and (ts is null or updated_at > ts)
         and not ((id::text || '#' || rev) = any(skip))
      union all
      select jsonb_build_object(
        'table', 'review', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
        'data', jsonb_build_object(
          'type', type, 'periodStart', period_start, 'periodEnd', period_end,
          'wins', wins, 'failures', failures, 'lesson', lesson,
          'mood', mood, 'energy', energy, 'nextPriorities', next_priorities,
          'attachments', attachments,
          'rev', rev, 'updatedAt', (extract(epoch from coalesce(edited_at, updated_at)) * 1000)::bigint)) as rec
        from public.reviews
       where user_id = auth.uid()
         and (snap is null or (txid >= lo and not pg_visible_in_snapshot(txid, snap)))
         and (ts is null or updated_at > ts)
         and not ((id::text || '#' || rev) = any(skip))
      union all
      select jsonb_build_object(
        'table', 'project', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
        'data', jsonb_build_object(
          'title', title, 'color', color, 'archived', archived,
          'rev', rev, 'updatedAt', (extract(epoch from coalesce(edited_at, updated_at)) * 1000)::bigint)) as rec
        from public.projects
       where user_id = auth.uid()
         and (snap is null or (txid >= lo and not pg_visible_in_snapshot(txid, snap)))
         and (ts is null or updated_at > ts)
         and not ((id::text || '#' || rev) = any(skip))
      union all
      select jsonb_build_object(
        'table', 'drawing', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
        'data', jsonb_build_object(
          'title', title, 'kind', kind, 'dataUrl', data_url,
          'text', text, 'format', format, 'attachments', attachments,
          'folderId', folder_id,
          'rev', rev, 'updatedAt', (extract(epoch from coalesce(edited_at, updated_at)) * 1000)::bigint)) as rec
        from public.drawings
       where user_id = auth.uid()
         and (snap is null or (txid >= lo and not pg_visible_in_snapshot(txid, snap)))
         and (ts is null or updated_at > ts)
         and not ((id::text || '#' || rev) = any(skip))
      union all
      select jsonb_build_object(
        'table', 'folder', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
        'data', jsonb_build_object(
          'name', name, 'parentId', parent_id, 'cover', cover,
          'coverY', cover_y, 'coverH', cover_h,
          'rev', rev, 'updatedAt', (extract(epoch from coalesce(edited_at, updated_at)) * 1000)::bigint)) as rec
        from public.sketch_folders
       where user_id = auth.uid()
         and (snap is null or (txid >= lo and not pg_visible_in_snapshot(txid, snap)))
         and (ts is null or updated_at > ts)
         and not ((id::text || '#' || rev) = any(skip))
    ) all_records;
  return res;
end;
$$;

-- ------------------------------------------------------------
-- grants: authenticated users may call the RPCs and touch their own rows.
-- RLS policies above are what actually restrict row visibility.
-- ------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update on public.profiles, public.tasks, public.goals,
  public.habits, public.habit_logs, public.reviews, public.projects,
  public.drawings, public.sketch_folders to authenticated;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(text, text[]) to authenticated;
grant execute on function public.recalc_goal(uuid) to authenticated;
grant execute on function public.merge_attachments(jsonb, jsonb, text[]) to authenticated;
-- …and only them: Supabase grants new functions to `anon` (a request with
-- no sign-in) by default. A sync call without a sign-in must be refused —
-- an anonymous pull used to come back "nothing changed" with a new cursor,
-- and the device then skipped other devices' changes for good.
revoke execute on function public.sync_push(jsonb) from public, anon;
revoke execute on function public.sync_pull(text, text[]) from public, anon;
revoke execute on function public.recalc_goal(uuid) from public, anon;
revoke execute on function public.merge_attachments(jsonb, jsonb, text[]) from public, anon;

-- ------------------------------------------------------------
-- Security advisor hardening (idempotent).
-- Pin search_path on the sync/trigger functions so they can't be steered
-- to look-alike objects in another schema. handle_new_user is a SECURITY
-- DEFINER trigger function — it only ever needs to fire from its trigger,
-- so no role gets to call it directly. citext stays in public on purpose:
-- profiles.username is typed citext and moving the extension breaks it.
-- ------------------------------------------------------------
alter function public.sync_push(jsonb) set search_path = public;
alter function public.sync_pull(text, text[]) set search_path = public;
alter function public.recalc_goal(uuid) set search_path = public;
alter function public.set_updated_at() set search_path = public;
alter function public.bump_rev() set search_path = public;
alter function public.merge_attachments(jsonb, jsonb, text[]) set search_path = public;
alter function public.all_fields(text) set search_path = public;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ------------------------------------------------------------
-- Live sync: one tiny row per user, bumped whenever any of their rows
-- change. Devices subscribe to it over Supabase Realtime and pull right
-- away, instead of waiting for the 60s poll. A dedicated signal table keeps
-- realtime messages tiny — subscribing to the data tables directly would
-- push whole multi-MB notes through Realtime on every save.
-- ------------------------------------------------------------
create table if not exists public.sync_signals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  changed_at timestamptz not null default now()
);
alter table public.sync_signals enable row level security;
drop policy if exists "read own signal" on public.sync_signals;
create policy "read own signal" on public.sync_signals for select using (user_id = auth.uid());
grant select on public.sync_signals to authenticated;

create or replace function public.bump_sync_signal()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.sync_signals (user_id, changed_at) values (new.user_id, now())
  on conflict (user_id) do update set changed_at = excluded.changed_at;
  return null;
end;
$$;
revoke execute on function public.bump_sync_signal() from public, anon, authenticated;
drop trigger if exists bump_sync_signal on public.tasks;
create trigger bump_sync_signal after insert or update on public.tasks
  for each row execute function public.bump_sync_signal();
drop trigger if exists bump_sync_signal on public.goals;
create trigger bump_sync_signal after insert or update on public.goals
  for each row execute function public.bump_sync_signal();
drop trigger if exists bump_sync_signal on public.habits;
create trigger bump_sync_signal after insert or update on public.habits
  for each row execute function public.bump_sync_signal();
drop trigger if exists bump_sync_signal on public.habit_logs;
create trigger bump_sync_signal after insert or update on public.habit_logs
  for each row execute function public.bump_sync_signal();
drop trigger if exists bump_sync_signal on public.reviews;
create trigger bump_sync_signal after insert or update on public.reviews
  for each row execute function public.bump_sync_signal();
drop trigger if exists bump_sync_signal on public.projects;
create trigger bump_sync_signal after insert or update on public.projects
  for each row execute function public.bump_sync_signal();
drop trigger if exists bump_sync_signal on public.drawings;
create trigger bump_sync_signal after insert or update on public.drawings
  for each row execute function public.bump_sync_signal();
drop trigger if exists bump_sync_signal on public.sketch_folders;
create trigger bump_sync_signal after insert or update on public.sketch_folders
  for each row execute function public.bump_sync_signal();

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sync_signals') then
    alter publication supabase_realtime add table public.sync_signals;
  end if;
end $$;

-- ------------------------------------------------------------
-- Attachment files (Supabase Storage). Non-image attachments on reviews and
-- Sketches notes live here instead of inline in the row — rows stay small,
-- files can be up to 50 MB (free-plan ceiling). Private bucket; each user
-- can only touch objects under their own "<user id>/" prefix. The record's
-- attachments JSON keeps {id, name, type, size, stored: 1}; the object path
-- is "<user id>/<attachment id>".
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "attachments: own files read" on storage.objects;
create policy "attachments: own files read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "attachments: own files insert" on storage.objects;
create policy "attachments: own files insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "attachments: own files update" on storage.objects;
create policy "attachments: own files update" on storage.objects for update to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "attachments: own files delete" on storage.objects;
create policy "attachments: own files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------------------------------------------
-- Statement timeout for signed-in users: Supabase's default is 8s, and a
-- record carrying a few MB of images/files (review attachments, Sketches
-- notes) can take longer than that to write — measured 4-6 MB pushes
-- landing anywhere from 5s to 12s depending on server load. 60s gives big
-- records (the app allows up to 8 MB, see MAX_RECORD_BYTES in
-- frontend/src/sync/engine.ts) and a new device's first full pull room.
-- ------------------------------------------------------------
alter role authenticated set statement_timeout = '60s';
notify pgrst, 'reload config';
