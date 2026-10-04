// Run the real supabase/schema.sql in a local Postgres (PGlite) with stubs
// for Supabase built-ins, then unit-test sync_push / sync_pull merging.
import { PGlite } from '@electric-sql/pglite'
import { citext } from '@electric-sql/pglite/contrib/citext'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import fs from 'fs'

const db = new PGlite({ extensions: { citext, pgcrypto } })
const schema = fs.readFileSync(new URL('../../supabase/schema.sql', import.meta.url), 'utf8')
const results = []
const check = (name, ok, extra = '') => { results.push(ok); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`) }

// ---- Supabase stand-ins
await db.exec(`
  create schema if not exists auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb, email_confirmed_at timestamptz);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  create schema if not exists storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create or replace function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
`)
let pubOk = true
try { await db.exec(`create publication supabase_realtime`) } catch { pubOk = false }
const runSchema = async () => {
  let sql = schema
  if (!pubOk) sql = sql.replace(/do \$\$\nbegin\n  if not exists \(select 1 from pg_publication_tables[\s\S]*?end \$\$;/, '-- (publication block skipped: not supported in PGlite)')
  await db.exec(sql)
}
try { await runSchema(); check('schema.sql runs on a fresh database', true) } catch (e) { check('schema.sql runs on a fresh database', false, e.message); process.exit(1) }
try { await runSchema(); check('schema.sql runs again (idempotent)', true) } catch (e) { check('schema.sql runs again (idempotent)', false, e.message); process.exit(1) }
if (!pubOk) console.log('  (note: PGlite has no logical replication — the realtime publication block was skipped here)')

const U1 = '11111111-1111-4111-8111-111111111111', U2 = '22222222-2222-4222-8222-222222222222'
await db.exec(`insert into auth.users (id, email) values ('${U1}', 'u1@x'), ('${U2}', 'u2@x') on conflict do nothing`)
const as = (uid) => db.exec(`select set_config('test.uid', '${uid}', false)`)
const push = async (items) => (await db.query(`select public.sync_push($1::jsonb) as r`, [JSON.stringify(items)])).rows[0].r.results
const pullRaw = async (since = '1970-01-01', skip = []) => (await db.query(`select public.sync_pull($1::text, $2::text[]) as r`, [since, skip])).rows[0].r
const pull = async (since, skip) => (await pullRaw(since, skip)).records
const row = async (table, id) => (await db.query(`select * from public.${table} where id = $1`, [id])).rows[0]
const uuid = () => crypto.randomUUID()
const reviewPayload = (o = {}) => ({ type: 'daily', periodStart: '2026-10-04', periodEnd: '2026-10-04', wins: '', failures: '', lesson: '', mood: '', energy: '', nextPriorities: '', attachments: [], deleted: '', ...o })
const att = (id, extra = {}) => ({ id, name: id + '.pdf', type: 'application/pdf', dataUrl: '', stored: 1, size: 10, ...extra })
const ALL_REVIEW = ['type', 'periodStart', 'periodEnd', 'wins', 'failures', 'lesson', 'mood', 'energy', 'nextPriorities', 'attachments', 'deleted']

await as(U1)
console.log('\n— merging')
const rid = uuid()
let r = await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ wins: 'base win', attachments: [att('a'), att('b')] }), edited_at: 1000, base_rev: null, fields: ALL_REVIEW, field_times: {}, att_up: ['a', 'b'], att_rm: [] }])
let rw = await row('reviews', rid)
check('new record inserted with rev 1 and every field time', r[0].outcome === 'applied' && r[0].rev == 1 && rw.wins === 'base win' && rw.attachments.length === 2 && Object.keys(rw.field_times).length === ALL_REVIEW.length)

// laptop adds a file; iPad (still on rev 1) changes the lesson — both from the same base
r = await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ wins: 'base win', attachments: [att('a'), att('b'), att('journal')] }), edited_at: 2000, base_rev: 1, fields: ['attachments'], field_times: { attachments: 2000 }, att_up: ['journal'], att_rm: [] }])
const laptopRes = r[0]
r = await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ lesson: 'typed on iPad', attachments: [att('a'), att('b')] }), edited_at: 2500, base_rev: 1, fields: ['lesson'], field_times: { lesson: 2500 }, att_up: [], att_rm: [] }])
rw = await row('reviews', rid)
check("laptop's new file AND iPad's lesson both survive (iPad's copy didn't have the file)", rw.lesson === 'typed on iPad' && rw.attachments.map((a) => a.id).join(',') === 'a,b,journal' && rw.wins === 'base win', JSON.stringify({ lesson: rw.lesson, att: rw.attachments.map((a) => a.id), wins: rw.wins }))
check('iPad is told it missed a change (foreign) so it pulls the row', r[0].foreign === true && laptopRes.foreign === false)
check('rev counts every write', rw.rev == 3, 'rev ' + rw.rev)

// same field edited on two devices: the later EDIT wins even if it arrives first
await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ wins: 'phone at 10:00' }), edited_at: 5000, base_rev: 3, fields: ['wins'], field_times: { wins: 5000 }, att_up: [], att_rm: [] }])
r = await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ wins: 'offline tablet at 09:00' }), edited_at: 4000, base_rev: 3, fields: ['wins'], field_times: { wins: 4000 }, att_up: [], att_rm: [] }])
rw = await row('reviews', rid)
check('same field: the most recent edit wins, even when the older one syncs last', rw.wins === 'phone at 10:00', rw.wins)

// attachments: one device removes a file while another adds one
await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ attachments: [att('b'), att('journal')] }), edited_at: 6000, base_rev: 5, fields: ['attachments'], field_times: { attachments: 6000 }, att_up: [], att_rm: ['a'] }])
await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ attachments: [att('a'), att('b'), att('journal'), att('c')] }), edited_at: 6100, base_rev: 5, fields: ['attachments'], field_times: { attachments: 6100 }, att_up: ['c'], att_rm: [] }])
rw = await row('reviews', rid)
check('removing a file on one device and adding another elsewhere → [b, journal, c]', rw.attachments.map((a) => a.id).join(',') === 'b,journal,c', rw.attachments.map((a) => a.id).join(','))
// replace an attachment's content (e.g. inline image moved to Storage) keeps its place
await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ attachments: [att('b', { size: 999 })] }), edited_at: 6200, base_rev: 7, fields: ['attachments'], field_times: { attachments: 6200 }, att_up: ['b'], att_rm: [] }])
rw = await row('reviews', rid)
check('an updated attachment is replaced in place', rw.attachments.map((a) => a.id + ':' + a.size).join(',') === 'b:999,journal:10,c:10', rw.attachments.map((a) => a.id + ':' + a.size).join(','))

// clearing a field still works ('' = clear)
await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ lesson: '' }), edited_at: 7000, base_rev: 8, fields: ['lesson'], field_times: { lesson: 7000 }, att_up: [], att_rm: [] }])
check('clearing a field propagates', (await row('reviews', rid)).lesson === null)

// delete on one device, edit of another field on another: stays deleted
await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ deleted: 1 }), edited_at: 8000, base_rev: 9, fields: ['deleted'], field_times: { deleted: 8000 }, att_up: [], att_rm: [] }])
await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ failures: 'late edit' }), edited_at: 8500, base_rev: 9, fields: ['failures'], field_times: { failures: 8500 }, att_up: [], att_rm: [] }])
rw = await row('reviews', rid)
check('a delete is not undone by an edit of another field elsewhere', rw.deleted === true && rw.failures === 'late edit')

// a device creates a record filling only `wins` (t=5000); another device,
// unaware, had edited `failures` offline EARLIER (t=3000) — it must still apply
const rid3 = uuid()
await push([{ table: 'review', client_uuid: rid3, payload: reviewPayload({ wins: 'laptop created it' }), edited_at: 5000, base_rev: null, fields: ['type', 'periodStart', 'periodEnd', 'wins', 'deleted'], field_times: {}, att_up: [], att_rm: [] }])
await push([{ table: 'review', client_uuid: rid3, payload: reviewPayload({ failures: 'tablet wrote this offline earlier' }), edited_at: 3000, base_rev: null, fields: ['type', 'periodStart', 'periodEnd', 'failures', 'deleted'], field_times: {}, att_up: [], att_rm: [] }])
rw = await row('reviews', rid3)
check("a new record doesn't outrank an earlier edit of a field it left empty", rw.wins === 'laptop created it' && rw.failures === 'tablet wrote this offline earlier', JSON.stringify({ w: rw.wins, f: rw.failures }))

console.log('\n— older app versions (no `fields`)')
const rid2 = uuid()
await push([{ table: 'review', client_uuid: rid2, payload: reviewPayload({ wins: 'v1', attachments: [att('x')] }), edited_at: 1000 }])
check('an old app version can still create records', (await row('reviews', rid2))?.wins === 'v1')
r = await push([{ table: 'review', client_uuid: rid2, payload: reviewPayload({ wins: 'older', attachments: [] }), edited_at: 500 }])
rw = await row('reviews', rid2)
check("an old version's OLDER whole-record save changes nothing newer", rw.wins === 'v1' && rw.attachments.length === 1, JSON.stringify({ wins: rw.wins, att: rw.attachments.length }))
// a new client edits one field at t=4000; an old client saves its whole (stale) record at t=3000
await push([{ table: 'review', client_uuid: rid2, payload: reviewPayload({ lesson: 'new client lesson' }), edited_at: 4000, base_rev: Number(rw.rev), fields: ['lesson'], field_times: { lesson: 4000 }, att_up: [], att_rm: [] }])
r = await push([{ table: 'review', client_uuid: rid2, payload: reviewPayload({ wins: 'old device win', lesson: '', attachments: [att('y')] }), edited_at: 3000 }])
rw = await row('reviews', rid2)
check("an old version can't wipe a field edited more recently elsewhere", rw.lesson === 'new client lesson', rw.lesson)
check("…its own newer edits apply, and its file list only adds (never drops others' files)", rw.wins === 'old device win' && rw.attachments.map((a) => a.id).sort().join(',') === 'x,y', JSON.stringify({ wins: rw.wins, att: rw.attachments.map((a) => a.id) }))
check('old versions get a result they understand', r[0].outcome === 'applied')
const ridOld = rid2

console.log('\n— tasks & goal roll-up')
const gid = uuid(), tid = uuid()
await push([{ table: 'goal', client_uuid: gid, payload: { title: 'G', type: 'week', parentId: '', lifeArea: '', whyItMatters: '', progress: 0, status: 'not_started', targetDate: '', deleted: '' }, edited_at: 1000, base_rev: null, fields: ['title', 'type', 'parentId', 'lifeArea', 'whyItMatters', 'progress', 'status', 'targetDate', 'deleted'], field_times: {}, att_up: [], att_rm: [] }])
const taskP = (o) => ({ title: 'T', notes: '', state: 'open', priority: 3, due: '2026-10-04', timeBlockStart: '', timeBlockEnd: '', estimatedHours: '', actualHours: '', goalId: gid, projectId: '', isMit: false, sortOrder: '', reminderDaysBefore: '', recurrence: '', seriesId: '', deleted: '', ...o })
const TASK_ALL = Object.keys(taskP({}))
await push([{ table: 'task', client_uuid: tid, payload: taskP({}), edited_at: 1000, base_rev: null, fields: TASK_ALL, field_times: {}, att_up: [], att_rm: [] }])
// phone renames (stale copy), laptop ticks done
await push([{ table: 'task', client_uuid: tid, payload: taskP({ title: 'Renamed on phone' }), edited_at: 2000, base_rev: 1, fields: ['title'], field_times: { title: 2000 }, att_up: [], att_rm: [] }])
await push([{ table: 'task', client_uuid: tid, payload: taskP({ state: 'done' }), edited_at: 2100, base_rev: 1, fields: ['state'], field_times: { state: 2100 }, att_up: [], att_rm: [] }])
const tr = await row('tasks', tid)
check('task renamed on one device and ticked on another keeps both', tr.title === 'Renamed on phone' && tr.state === 'done')
check("ticking it re-computes its goal's progress", (await row('goals', gid)).progress === 100)
// moving the task to another goal recomputes both goals
const gid2 = uuid()
await push([{ table: 'goal', client_uuid: gid2, payload: { title: 'G2', type: 'week', parentId: '', lifeArea: '', whyItMatters: '', progress: 0, status: 'not_started', targetDate: '', deleted: '' }, edited_at: 1000, base_rev: null, fields: ['title', 'type', 'parentId', 'lifeArea', 'whyItMatters', 'progress', 'status', 'targetDate', 'deleted'], field_times: {}, att_up: [], att_rm: [] }])
await push([{ table: 'task', client_uuid: tid, payload: taskP({ goalId: gid2 }), edited_at: 3000, base_rev: 3, fields: ['goalId'], field_times: { goalId: 3000 }, att_up: [], att_rm: [] }])
check('moving a task between goals recomputes the new goal', (await row('goals', gid2)).progress === 100)

console.log('\n— pull')
let recs = await pull()
const rv = recs.find((x) => x.client_uuid === rid)
check('pull reports each record\'s rev', rv && Number(rv.data.rev) === Number((await row('reviews', rid)).rev), rv ? 'rev ' + rv.data.rev : 'missing')
const revOld = Number((await row('reviews', ridOld)).rev)
recs = await pull('1970-01-01', [`${ridOld}#${revOld}`])
check('a skip key (id#rev) leaves out exactly that version', !recs.some((x) => x.client_uuid === ridOld) && recs.some((x) => x.client_uuid === rid))
const ed2 = Number((await db.query(`select (extract(epoch from edited_at) * 1000)::bigint as ms from public.reviews where id = $1`, [ridOld])).rows[0].ms)
recs = await pull('1970-01-01', [`${ridOld}:${ed2}`])
check("an old app's skip key (id:time) matches nothing — it just re-downloads its save", recs.some((x) => x.client_uuid === ridOld))
// an older edit that loses to a newer one is reported, so the device re-pulls
r = await push([{ table: 'review', client_uuid: ridOld, payload: reviewPayload({ wins: 'too old' }), edited_at: 100, base_rev: Number((await row('reviews', ridOld)).rev), fields: ['wins'], field_times: { wins: 100 }, att_up: [], att_rm: [] }])
check('a field edit that loses to a newer one is flagged so the device re-pulls', r[0].foreign === true && (await row('reviews', ridOld)).wins === 'old device win')

console.log('\n— pull cursor')
let full = await pullRaw('1970-01-01')
const cur1 = full.cursor
check('a pull hands back a snapshot cursor', /^\d+:\d+:/.test(cur1), cur1)
check('…and nothing comes back when nothing changed since', (await pull(cur1)).length === 0)
// another device saves a row → exactly that row comes next time
await push([{ table: 'review', client_uuid: rid3, payload: reviewPayload({ lesson: 'from another device' }), edited_at: 9000, base_rev: Number((await row('reviews', rid3)).rev), fields: ['lesson'], field_times: { lesson: 9000 }, att_up: [], att_rm: [] }])
recs = await pull(cur1)
check('a row saved after the cursor comes through', recs.length === 1 && recs[0].client_uuid === rid3 && recs[0].data.lesson === 'from another device', recs.map((x) => x.client_uuid).join(','))
const cur2 = (await pullRaw(cur1)).cursor
check('…once only: the next cursor is past it', (await pull(cur2)).length === 0)
// a save that was still COMMITTING when the last pull ran: its transaction
// is listed as in progress in that pull's snapshot ("xmin:xmax:xip")
const tx = (await db.query(`select txid::text as t from public.reviews where id = $1`, [rid3])).rows[0].t
const inFlight = `${tx}:${BigInt(tx) + 1n}:${tx}`
recs = await pull(inFlight)
check('a save still committing during the last pull is NOT lost (the timestamp cursor lost it)', recs.some((x) => x.client_uuid === rid3), inFlight)
check('rows finished before that snapshot are not re-sent', !recs.some((x) => x.client_uuid === rid))
// older app versions keep their timestamp cursors working
const ts = (await db.query(`select (updated_at - interval '1 second')::text as t from public.reviews where id = $1`, [rid3])).rows[0].t
recs = await pull(ts)
check('a timestamp cursor (older app) still works, and steps back for saves mid-commit', recs.some((x) => x.client_uuid === rid3))
check('a garbled cursor sends everything instead of failing', (await pull('garbage:cursor')).length === (await pull('1970-01-01')).length)
const tr2 = (await db.query(`select rev, txid::text as t from public.reviews where id = $1`, [rid3])).rows[0]
check('every write records its transaction (txid) and bumps rev', tr2.t === tx && Number(tr2.rev) >= 2)
const newId = uuid()
await push([{ table: 'review', client_uuid: newId, payload: reviewPayload({ wins: 'fresh' }), edited_at: 9100, base_rev: null, fields: ['type', 'periodStart', 'periodEnd', 'wins', 'deleted'], field_times: {}, att_up: [], att_rm: [] }])
const nr = (await db.query(`select rev, txid from public.reviews where id = $1`, [newId])).rows[0]
check('a new row starts at rev 1 with its txid set', Number(nr.rev) === 1 && nr.txid !== null)

console.log('\n— accounts stay apart')
await as(U2)
r = await push([{ table: 'review', client_uuid: rid, payload: reviewPayload({ wins: 'intruder' }), edited_at: 99999, base_rev: 1, fields: ['wins'], field_times: { wins: 99999 }, att_up: [], att_rm: [] }])
check("another account can't write someone else's record — and is told so ('rejected')", (await db.query(`select wins from public.reviews where id = $1`, [rid])).rows[0].wins === 'phone at 10:00' && r[0].outcome === 'rejected', r[0].outcome)
check("another account's pull sees none of it", (await pull()).length === 0)

console.log(`\n${results.filter(Boolean).length}/${results.length} SQL checks passed`)
if (results.some((ok) => !ok)) process.exitCode = 1
