-- ============================================================
-- One-time setup: reminders while the app is closed (push notifications).
--
-- 1. Run supabase/schema.sql first (it has the reminder tables/functions).
-- 2. Deploy the Edge Function: Supabase → Edge Functions → Deploy a new
--    function → Via editor, name it  push-reminders , paste
--    supabase/functions/push-reminders/index.ts, Deploy. Then in that
--    function's settings turn OFF "Enforce JWT verification".
-- 3. Run this file in the SQL Editor with <PRIVATE-KEY-JWK> replaced by the
--    push key: VAPID_PRIVATE_JWK in frontend/.env.local. That key is secret —
--    never commit a filled-in copy of this file. It's kept in Vault; the
--    app holds only its public half (VAPID_PUBLIC_KEY in lib/reminders.ts).
--
-- Safe to run again (e.g. with a new key — then update VAPID_PUBLIC_KEY in
-- the app and the function too). To stop reminders by push:
--   select cron.unschedule('planner-reminders');
-- ============================================================
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare
  k text := '<PRIVATE-KEY-JWK>';
begin
  if k like '<%' then
    raise exception 'Paste the push key (VAPID_PRIVATE_JWK) in place of <PRIVATE-KEY-JWK> first';
  end if;
  perform k::jsonb;  -- must be the JSON key
  if exists (select 1 from vault.secrets where name = 'planner_vapid') then
    perform vault.update_secret((select id from vault.secrets where name = 'planner_vapid'), k);
  else
    perform vault.create_secret(k, 'planner_vapid', 'Planner reminders: push (VAPID) private key');
  end if;
end $$;

-- every minute: send the reminders that are due (schema.sql → send_due_reminders)
select cron.schedule('planner-reminders', '* * * * *', 'select public.send_due_reminders()');
-- and keep the timer's log short
select cron.schedule('planner-cron-cleanup', '17 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '2 days'$$);
