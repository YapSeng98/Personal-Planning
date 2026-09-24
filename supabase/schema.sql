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
-- recalc_goal — recompute a goal's progress, then every ancestor's.
-- Mirrors rollUpGoal in frontend/src/db/db.ts; keep the two in step.
-- Any level can have tasks linked directly, so a goal's progress is the
-- average of its parts: each non-deleted child goal is one part, and all
-- its directly linked (non-deleted, non-cancelled) tasks together are one
-- more part (done / total). A goal with no parts keeps its manually set
-- progress — no tasks never means done. Status: completed only at 100%; a
-- completed goal that drops below goes back to in_progress / not_started.
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
        progress = v_pct,
        status = case
          when v_pct >= 100 then 'completed'
          when status = 'completed' then case when v_pct > 0 then 'in_progress' else 'not_started' end
          when v_pct > 0 and status = 'not_started' then 'in_progress'
          else status
        end
      where id = v_id;
    end if;

    select parent_id into v_id from public.goals where id = v_id;
    depth := depth + 1;
  end loop;
end;
$$;

-- ------------------------------------------------------------
-- sync_push — same contract as POST /sync/push. items: jsonb array of
-- {table, client_uuid, payload, edited_at}. payload always carries every
-- syncable field (buildPayload() in engine.ts sends '' for anything
-- undefined, never omits it) — that '' is what makes CLEARING a field
-- actually propagate, exactly like the ServiceNow version, so every cast
-- below goes through nullif(x,'') first: an empty string means "clear
-- this", never "0" and never "crash the cast".
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
  edited_ts timestamptz;
  existing_updated timestamptz;
  results jsonb := '[]'::jsonb;
  affected_goals uuid[] := '{}';
  goal_id_val uuid;
  g uuid;
begin
  for item in select * from jsonb_array_elements(items)
  loop
    tbl := item->>'table';
    rid := (item->>'client_uuid')::uuid;
    p := item->'payload';
    edited_ts := to_timestamp((item->>'edited_at')::bigint / 1000.0);
    goal_id_val := null;

    if tbl = 'task' then
      select updated_at into existing_updated from public.tasks where id = rid and user_id = auth.uid();
      if found and existing_updated > edited_ts then
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'server_won');
      else
        goal_id_val := nullif(p->>'goalId', '')::uuid;
        insert into public.tasks (id, user_id, title, notes, state, priority, due,
          time_block_start, time_block_end, estimated_hours, actual_hours,
          goal_id, project_id, is_mit, sort_order, reminder_days_before,
          recurrence, series_id, deleted)
        values (rid, auth.uid(),
          coalesce(nullif(p->>'title', ''), ''),
          nullif(p->>'notes', ''),
          coalesce(nullif(p->>'state', ''), 'open'),
          coalesce(nullif(p->>'priority', '')::int, 3),
          nullif(p->>'due', '')::date,
          nullif(p->>'timeBlockStart', '')::timestamptz,
          nullif(p->>'timeBlockEnd', '')::timestamptz,
          nullif(p->>'estimatedHours', '')::numeric,
          nullif(p->>'actualHours', '')::numeric,
          goal_id_val,
          nullif(p->>'projectId', '')::uuid,
          coalesce(nullif(p->>'isMit', '')::boolean, false),
          nullif(p->>'sortOrder', '')::int,
          nullif(p->>'reminderDaysBefore', '')::int,
          nullif(p->>'recurrence', ''),
          nullif(p->>'seriesId', '')::uuid,
          coalesce(nullif(p->>'deleted', '')::boolean, false)
        )
        on conflict (id) do update set
          title = excluded.title, notes = excluded.notes, state = excluded.state,
          priority = excluded.priority, due = excluded.due,
          time_block_start = excluded.time_block_start, time_block_end = excluded.time_block_end,
          estimated_hours = excluded.estimated_hours, actual_hours = excluded.actual_hours,
          goal_id = excluded.goal_id, project_id = excluded.project_id,
          is_mit = excluded.is_mit, sort_order = excluded.sort_order,
          reminder_days_before = excluded.reminder_days_before,
          recurrence = excluded.recurrence, series_id = excluded.series_id,
          deleted = excluded.deleted
        where public.tasks.user_id = auth.uid();

        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied');
        if goal_id_val is not null then
          affected_goals := affected_goals || goal_id_val;
        end if;
      end if;

    elsif tbl = 'goal' then
      select updated_at into existing_updated from public.goals where id = rid and user_id = auth.uid();
      if found and existing_updated > edited_ts then
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'server_won');
      else
        insert into public.goals (id, user_id, title, type, parent_id, life_area,
          why_it_matters, progress, status, target_date, deleted)
        values (rid, auth.uid(),
          coalesce(nullif(p->>'title', ''), ''),
          coalesce(nullif(p->>'type', ''), 'week'),
          nullif(p->>'parentId', '')::uuid,
          nullif(p->>'lifeArea', ''),
          nullif(p->>'whyItMatters', ''),
          coalesce(nullif(p->>'progress', '')::int, 0),
          coalesce(nullif(p->>'status', ''), 'not_started'),
          nullif(p->>'targetDate', '')::date,
          coalesce(nullif(p->>'deleted', '')::boolean, false)
        )
        on conflict (id) do update set
          title = excluded.title, type = excluded.type, parent_id = excluded.parent_id,
          life_area = excluded.life_area, why_it_matters = excluded.why_it_matters,
          progress = excluded.progress, status = excluded.status,
          target_date = excluded.target_date, deleted = excluded.deleted
        where public.goals.user_id = auth.uid();

        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied');
        affected_goals := affected_goals || rid;
      end if;

    elsif tbl = 'habit' then
      select updated_at into existing_updated from public.habits where id = rid and user_id = auth.uid();
      if found and existing_updated > edited_ts then
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'server_won');
      else
        insert into public.habits (id, user_id, name, emoji, frequency, target_per_day, active, deleted)
        values (rid, auth.uid(),
          coalesce(nullif(p->>'name', ''), ''),
          nullif(p->>'emoji', ''),
          coalesce(nullif(p->>'frequency', ''), 'daily'),
          coalesce(nullif(p->>'targetPerDay', '')::int, 1),
          coalesce(nullif(p->>'active', '')::boolean, true),
          coalesce(nullif(p->>'deleted', '')::boolean, false)
        )
        on conflict (id) do update set
          name = excluded.name, emoji = excluded.emoji, frequency = excluded.frequency,
          target_per_day = excluded.target_per_day, active = excluded.active, deleted = excluded.deleted
        where public.habits.user_id = auth.uid();
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied');
      end if;

    elsif tbl = 'habit_log' then
      select updated_at into existing_updated from public.habit_logs where id = rid and user_id = auth.uid();
      if found and existing_updated > edited_ts then
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'server_won');
      else
        insert into public.habit_logs (id, user_id, habit_id, date, count, deleted)
        values (rid, auth.uid(),
          nullif(p->>'habitId', '')::uuid,
          nullif(p->>'date', '')::date,
          coalesce(nullif(p->>'count', '')::int, 0),
          coalesce(nullif(p->>'deleted', '')::boolean, false)
        )
        on conflict (id) do update set
          habit_id = excluded.habit_id, date = excluded.date, count = excluded.count, deleted = excluded.deleted
        where public.habit_logs.user_id = auth.uid();
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied');
      end if;

    elsif tbl = 'review' then
      select updated_at into existing_updated from public.reviews where id = rid and user_id = auth.uid();
      if found and existing_updated > edited_ts then
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'server_won');
      else
        insert into public.reviews (id, user_id, type, period_start, period_end, wins,
          failures, lesson, mood, energy, next_priorities, deleted)
        values (rid, auth.uid(),
          coalesce(nullif(p->>'type', ''), 'daily'),
          nullif(p->>'periodStart', '')::date,
          nullif(p->>'periodEnd', '')::date,
          nullif(p->>'wins', ''),
          nullif(p->>'failures', ''),
          nullif(p->>'lesson', ''),
          nullif(p->>'mood', ''),
          nullif(p->>'energy', '')::int,
          nullif(p->>'nextPriorities', ''),
          coalesce(nullif(p->>'deleted', '')::boolean, false)
        )
        on conflict (id) do update set
          type = excluded.type, period_start = excluded.period_start, period_end = excluded.period_end,
          wins = excluded.wins, failures = excluded.failures, lesson = excluded.lesson,
          mood = excluded.mood, energy = excluded.energy, next_priorities = excluded.next_priorities,
          deleted = excluded.deleted
        where public.reviews.user_id = auth.uid();
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied');
      end if;

    elsif tbl = 'project' then
      select updated_at into existing_updated from public.projects where id = rid and user_id = auth.uid();
      if found and existing_updated > edited_ts then
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'server_won');
      else
        insert into public.projects (id, user_id, title, color, archived, deleted)
        values (rid, auth.uid(),
          coalesce(nullif(p->>'title', ''), ''),
          coalesce(nullif(p->>'color', ''), 'coral'),
          coalesce(nullif(p->>'archived', '')::boolean, false),
          coalesce(nullif(p->>'deleted', '')::boolean, false)
        )
        on conflict (id) do update set
          title = excluded.title, color = excluded.color, archived = excluded.archived, deleted = excluded.deleted
        where public.projects.user_id = auth.uid();
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied');
      end if;

    elsif tbl = 'drawing' then
      select updated_at into existing_updated from public.drawings where id = rid and user_id = auth.uid();
      if found and existing_updated > edited_ts then
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'server_won');
      else
        insert into public.drawings (id, user_id, title, kind, data_url, text, format, attachments, folder_id, deleted)
        values (rid, auth.uid(),
          coalesce(nullif(p->>'title', ''), ''),
          coalesce(nullif(p->>'kind', ''), 'draw'),
          nullif(p->>'dataUrl', ''),
          nullif(p->>'text', ''),
          nullif(p->>'format', ''),
          case when jsonb_typeof(p->'attachments') = 'array' then p->'attachments' else '[]'::jsonb end,
          nullif(p->>'folderId', '')::uuid,
          coalesce(nullif(p->>'deleted', '')::boolean, false)
        )
        on conflict (id) do update set
          title = excluded.title, kind = excluded.kind, data_url = excluded.data_url,
          text = excluded.text, format = excluded.format, attachments = excluded.attachments,
          folder_id = excluded.folder_id, deleted = excluded.deleted
        where public.drawings.user_id = auth.uid();
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied');
      end if;

    elsif tbl = 'folder' then
      select updated_at into existing_updated from public.sketch_folders where id = rid and user_id = auth.uid();
      if found and existing_updated > edited_ts then
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'server_won');
      else
        insert into public.sketch_folders (id, user_id, name, deleted)
        values (rid, auth.uid(),
          coalesce(nullif(p->>'name', ''), ''),
          coalesce(nullif(p->>'deleted', '')::boolean, false)
        )
        on conflict (id) do update set
          name = excluded.name, deleted = excluded.deleted
        where public.sketch_folders.user_id = auth.uid();
        results := results || jsonb_build_object('client_uuid', rid, 'sys_id', rid::text, 'outcome', 'applied');
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
-- sync_pull — same contract as GET /sync/pull?since=. Returns every row
-- across all 6 tables changed after `since`, plus a fresh cursor (now()).
-- updatedAt is emitted as epoch-milliseconds to match Task.updatedAt's
-- existing type (a number, from Date.now() historically) — engine.ts's
-- client-side LWW guard compares it directly against local.updatedAt.
-- ------------------------------------------------------------
create or replace function public.sync_pull(since timestamptz)
returns jsonb
language sql
security invoker
as $$
  select jsonb_build_object(
    'cursor', now(),
    'records', coalesce(jsonb_agg(rec), '[]'::jsonb)
  )
  from (
    select jsonb_build_object(
      'table', 'task', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
      'data', jsonb_build_object(
        'title', title, 'notes', notes, 'state', state, 'priority', priority,
        'due', due, 'timeBlockStart', time_block_start, 'timeBlockEnd', time_block_end,
        'estimatedHours', estimated_hours, 'actualHours', actual_hours,
        'goalId', goal_id, 'projectId', project_id, 'isMit', is_mit,
        'sortOrder', sort_order, 'reminderDaysBefore', reminder_days_before,
        'recurrence', recurrence, 'seriesId', series_id,
        'updatedAt', (extract(epoch from updated_at) * 1000)::bigint
      )
    ) as rec
    from public.tasks where user_id = auth.uid() and updated_at > since
    union all
    select jsonb_build_object(
      'table', 'goal', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
      'data', jsonb_build_object(
        'title', title, 'type', type, 'parentId', parent_id,
        'lifeArea', life_area, 'whyItMatters', why_it_matters,
        'progress', progress, 'status', status, 'targetDate', target_date,
        'updatedAt', (extract(epoch from updated_at) * 1000)::bigint
      )
    )
    from public.goals where user_id = auth.uid() and updated_at > since
    union all
    select jsonb_build_object(
      'table', 'habit', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
      'data', jsonb_build_object(
        'name', name, 'emoji', emoji, 'frequency', frequency,
        'targetPerDay', target_per_day, 'active', active,
        'updatedAt', (extract(epoch from updated_at) * 1000)::bigint
      )
    )
    from public.habits where user_id = auth.uid() and updated_at > since
    union all
    select jsonb_build_object(
      'table', 'habit_log', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
      'data', jsonb_build_object(
        'habitId', habit_id, 'date', date, 'count', count,
        'updatedAt', (extract(epoch from updated_at) * 1000)::bigint
      )
    )
    from public.habit_logs where user_id = auth.uid() and updated_at > since
    union all
    select jsonb_build_object(
      'table', 'review', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
      'data', jsonb_build_object(
        'type', type, 'periodStart', period_start, 'periodEnd', period_end,
        'wins', wins, 'failures', failures, 'lesson', lesson, 'mood', mood,
        'energy', energy, 'nextPriorities', next_priorities,
        'updatedAt', (extract(epoch from updated_at) * 1000)::bigint
      )
    )
    from public.reviews where user_id = auth.uid() and updated_at > since
    union all
    select jsonb_build_object(
      'table', 'project', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
      'data', jsonb_build_object(
        'title', title, 'color', color, 'archived', archived,
        'updatedAt', (extract(epoch from updated_at) * 1000)::bigint
      )
    )
    from public.projects where user_id = auth.uid() and updated_at > since
    union all
    select jsonb_build_object(
      'table', 'drawing', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
      'data', jsonb_build_object(
        'title', title, 'kind', kind, 'dataUrl', data_url, 'text', text,
        'format', format, 'attachments', attachments, 'folderId', folder_id,
        'updatedAt', (extract(epoch from updated_at) * 1000)::bigint
      )
    )
    from public.drawings where user_id = auth.uid() and updated_at > since
    union all
    select jsonb_build_object(
      'table', 'folder', 'client_uuid', id, 'sys_id', id::text, 'deleted', deleted,
      'data', jsonb_build_object(
        'name', name,
        'updatedAt', (extract(epoch from updated_at) * 1000)::bigint
      )
    )
    from public.sketch_folders where user_id = auth.uid() and updated_at > since
  ) all_records;
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
grant execute on function public.sync_pull(timestamptz) to authenticated;
grant execute on function public.recalc_goal(uuid) to authenticated;
