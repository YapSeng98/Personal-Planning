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

console.log('\n— no sign-in')
// A request without a sign-in token must be refused — an anonymous pull used
// to answer "nothing changed" with a fresh cursor, and the device that sent
// it (mid token refresh) then skipped every change made elsewhere.
const refused = async (fn) => { try { await fn(); return false } catch (e) { return /not signed in|permission denied/i.test(e.message) } }
await as('')
check('no account: a pull is refused (not answered "nothing changed")', await refused(() => pullRaw('1970-01-01')))
check('no account: a push is refused', await refused(() => push([])))
await as(U1)
const anonDenied = async (sql) => { await db.exec('set role anon'); try { return await refused(() => db.query(sql)) } finally { await db.exec('reset role') } }
check("the anonymous role can't even call sync_pull / sync_push", await anonDenied(`select public.sync_pull('1970-01-01', '{}')`) && await anonDenied(`select public.sync_push('[]'::jsonb)`))
check('…while a signed-in account still syncs', (await pull()).length > 0)

console.log('\n— a field added later: pinned notes')
const did = uuid()
const note = (o = {}) => ({ title: 'Note', kind: 'text', dataUrl: '', text: 'hello', format: 'html', attachments: [], folderId: '', pinned: '', deleted: '', ...o })
const drawing = async () => row('drawings', did)
await push([{ table: 'drawing', client_uuid: did, payload: note(), edited_at: 1000, base_rev: null, fields: ['title', 'kind', 'text', 'format', 'deleted'], field_times: {}, att_up: [], att_rm: [] }])
check('a new note starts unpinned', (await drawing()).pinned === false)
r = await push([{ table: 'drawing', client_uuid: did, payload: note({ pinned: true }), edited_at: 2000, base_rev: 1, fields: ['pinned'], field_times: { pinned: 2000 }, att_up: [], att_rm: [] }])
check('pinning syncs as its own field', (await drawing()).pinned === true && r[0].outcome === 'applied')
// another device, still holding the unpinned copy, edits the text
await push([{ table: 'drawing', client_uuid: did, payload: note({ text: 'edited elsewhere' }), edited_at: 3000, base_rev: 1, fields: ['text'], field_times: { text: 3000 }, att_up: [], att_rm: [] }])
let dr = await drawing()
check('editing the note on a device that never saw the pin keeps it pinned', dr.pinned === true && dr.text === 'edited elsewhere', JSON.stringify({ pinned: dr.pinned, text: dr.text }))
// an app version from before field lists: whole record, no `fields`, and of course no `pinned`
await push([{ table: 'drawing', client_uuid: did, payload: { title: 'Renamed by an old app', kind: 'text', dataUrl: '', text: 'old app text', format: 'html', attachments: [], folderId: '', deleted: '' }, edited_at: 4000 }])
dr = await drawing()
check("an old app version saving the whole note doesn't unpin it", dr.pinned === true && dr.title === 'Renamed by an old app', JSON.stringify({ pinned: dr.pinned, title: dr.title }))
const pr = await pullRaw('1970-01-01')
check('a pull carries the pin', pr.records.find((x) => x.client_uuid === did)?.data.pinned === true)
await push([{ table: 'drawing', client_uuid: did, payload: note({ pinned: false }), edited_at: 5000, base_rev: Number(dr.rev), fields: ['pinned'], field_times: { pinned: 5000 }, att_up: [], att_rm: [] }])
check('unpinning syncs', (await drawing()).pinned === false)
// the app holds back changes to fields the server doesn't list — so the lists must agree
const { SYNC_FIELDS, LATER_FIELDS } = await import('../src/sync/fields.ts')
const sameLists = Object.keys(SYNC_FIELDS).length === Object.keys(pr.fields ?? {}).length
  && Object.keys(SYNC_FIELDS).every((t) => JSON.stringify(pr.fields[t]) === JSON.stringify(SYNC_FIELDS[t]))
check("the server's field list (sync_pull.fields) matches the app's SYNC_FIELDS", sameLists, JSON.stringify(pr.fields?.drawing))
const oldApp = {}
for (const t of Object.keys(SYNC_FIELDS)) oldApp[t] = (await db.query(`select public.all_fields($1) as f`, [t])).rows[0].f
check("…and the fields old app versions can't touch (all_fields) are exactly the app's LATER_FIELDS",
  Object.keys(SYNC_FIELDS).every((t) => JSON.stringify(SYNC_FIELDS[t].filter((f) => !oldApp[t].includes(f))) === JSON.stringify(LATER_FIELDS[t] ?? [])))

{
console.log('\n— a task\'s steps and focus sessions (merged item by item)')
const tid = uuid()
const TF = ['title', 'state', 'priority', 'due', 'deleted']
const taskP = (o = {}) => ({ title: 'Prepare slides', notes: '', state: 'open', priority: 3, due: '2026-10-22', timeBlockStart: '', timeBlockEnd: '', estimatedHours: '', actualHours: '', goalId: '', projectId: '', isMit: '', sortOrder: '', reminderDaysBefore: '', recurrence: '', seriesId: '', checklist: '', focusLog: '', deleted: '', ...o })
const task = async () => row('tasks', tid)
const step = (id, text, t, o = {}) => ({ id, text, t, ...o })
await push([{ table: 'task', client_uuid: tid, payload: taskP({ checklist: [step('a', 'Numbers', 1000), step('b', 'Draft', 1000)] }), edited_at: 1000, base_rev: null, fields: [...TF, 'checklist'], field_times: {}, att_up: [], att_rm: [] }])
check('a new task keeps its steps', (await task()).checklist.length === 2)
// laptop ticks step a; phone (same base) ticks step b and adds c — both offline, then sync
r = await push([{ table: 'task', client_uuid: tid, payload: taskP({ checklist: [step('a', 'Numbers', 2000, { done: 1 }), step('b', 'Draft', 1000)] }), edited_at: 2000, base_rev: 1, fields: ['checklist'], field_times: { checklist: 2000 }, att_up: [], att_rm: [] }])
const phone = await push([{ table: 'task', client_uuid: tid, payload: taskP({ checklist: [step('a', 'Numbers', 1000), step('b', 'Draft', 1500, { done: 1 }), step('c', 'Review', 1500)] }), edited_at: 1500, base_rev: 1, fields: ['checklist'], field_times: { checklist: 1500 }, att_up: [], att_rm: [] }])
let tk = await task()
const byId = Object.fromEntries(tk.checklist.map((x) => [x.id, x]))
check('two devices ticking different steps: both kept (even the older push), and the new step', byId.a.done === 1 && byId.b.done === 1 && byId.c?.text === 'Review' && tk.checklist.length === 3, JSON.stringify(tk.checklist))
check('…order kept, new steps at the end', tk.checklist.map((x) => x.id).join('') === 'abc')
check('…and the device whose copy was out of date is told to pull', phone[0].foreign === true)
// the same step: the later edit wins, whatever order they arrive in
await push([{ table: 'task', client_uuid: tid, payload: taskP({ checklist: [step('c', 'Review with Ana', 4000)] }), edited_at: 4000, base_rev: null, fields: ['checklist'], field_times: { checklist: 4000 }, att_up: [], att_rm: [] }])
await push([{ table: 'task', client_uuid: tid, payload: taskP({ checklist: [step('c', 'Review (old)', 3000)] }), edited_at: 3000, base_rev: null, fields: ['checklist'], field_times: { checklist: 3000 }, att_up: [], att_rm: [] }])
tk = await task()
check('the same step renamed on two devices: the later edit wins', tk.checklist.find((x) => x.id === 'c').text === 'Review with Ana')
// removing a step beats an older edit of it from elsewhere
await push([{ table: 'task', client_uuid: tid, payload: taskP({ checklist: [{ id: 'b', text: '', del: 1, t: 5000 }] }), edited_at: 5000, base_rev: null, fields: ['checklist'], field_times: { checklist: 5000 }, att_up: [], att_rm: [] }])
await push([{ table: 'task', client_uuid: tid, payload: taskP({ checklist: [step('b', 'Draft v2', 4500)] }), edited_at: 4500, base_rev: null, fields: ['checklist'], field_times: { checklist: 4500 }, att_up: [], att_rm: [] }])
tk = await task()
check('a removed step stays removed (an older edit arriving later doesn\'t bring it back)', tk.checklist.find((x) => x.id === 'b').del === 1)
// focus sessions: two devices timing the same task both count
await push([{ table: 'task', client_uuid: tid, payload: taskP({ focusLog: [{ id: 's1', d: '2026-10-22', m: 25, t: 6000 }], actualHours: 0.417 }), edited_at: 6000, base_rev: null, fields: ['focusLog', 'actualHours'], field_times: {}, att_up: [], att_rm: [] }])
await push([{ table: 'task', client_uuid: tid, payload: taskP({ focusLog: [{ id: 's2', d: '2026-10-22', m: 10, t: 5900 }], actualHours: 0.167 }), edited_at: 5900, base_rev: null, fields: ['focusLog', 'actualHours'], field_times: {}, att_up: [], att_rm: [] }])
tk = await task()
check('focus sessions from two devices are both kept (the total alone would lose one)', tk.focus_log.length === 2 && tk.focus_log.reduce((n, x) => n + x.m, 0) === 35, JSON.stringify(tk.focus_log))
// an old app version saving the whole task
await push([{ table: 'task', client_uuid: tid, payload: { title: 'Renamed by an old app', notes: '', state: 'open', priority: 3, due: '2026-10-22', deleted: '' }, edited_at: 7000 }])
tk = await task()
check("an old app version saving the whole task keeps the steps and sessions", tk.title === 'Renamed by an old app' && tk.checklist.length === 3 && tk.focus_log.length === 2)
const tpull = (await pull()).find((x) => x.client_uuid === tid)
check('a pull carries both lists', tpull.data.checklist.length === 3 && tpull.data.focusLog.length === 2)
check('merge_items: nothing and nothing stays nothing', (await db.query(`select public.merge_items(null, null) as m`)).rows[0].m === null)
const { mergeItems } = await import('../src/lib/items.ts')
const cases = [
  [[step('a', 'x', 1), step('b', 'y', 5)], [step('b', 'y2', 4), step('c', 'z', 2), step('a', 'x2', 1)]],
  [null, [step('a', 'x', 1)]],
  [[step('a', 'x', 3, { del: 1 })], [step('a', 'x', 2), step('a', 'dup', 9)]],
]
let same = true
for (const [a, b] of cases) {
  const sql = (await db.query(`select public.merge_items($1::jsonb, $2::jsonb) as m`, [JSON.stringify(a), JSON.stringify(b)])).rows[0].m
  // (jsonb keeps keys in its own order)
  const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x))
  same &&= canon(sql) === canon(mergeItems(a ?? undefined, b))
}
check('the app merges a list exactly like the server (lib/items.ts = merge_items)', same)

console.log('\n— reminders (push)')
await db.exec(`
  create schema if not exists vault; create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text, secret text);
  create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
  create schema if not exists net; create table if not exists net.calls (url text, body jsonb);
  create table if not exists net._http_response (id bigint, status_code int, content text, created timestamptz default now());
  create or replace function net.http_post(url text, body jsonb, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
    returns bigint language sql as $$ insert into net.calls values (url, body); select 1::bigint $$;
`)
const saveSub = (o = {}) => db.query(`select public.save_push_subscription($1::jsonb)`, [JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/dev1', p256dh: 'BPk', auth: 'au', tz: 'Asia/Kuala_Lumpur', lang: 'en', lead: 10, ...o })])
await as(U1)
await saveSub()
check('a device registers for reminders', (await db.query(`select * from public.push_subscriptions`)).rows.length === 1)
await saveSub({ endpoint: 'https://fcm.googleapis.com/fcm/send/dev2', tz: 'Not/AZone' })
check('a time zone the database doesn\'t know is stored as UTC (it would break every reminder)', (await db.query(`select tz from public.push_subscriptions where endpoint like '%dev2'`)).rows[0].tz === 'UTC')
await db.query(`select public.delete_push_subscription('https://fcm.googleapis.com/fcm/send/dev2')`)
let badRefused = false
try { await saveSub({ endpoint: 'http://evil/x' }) } catch { badRefused = true }
check('only real push addresses are accepted', badRefused)
await as(U2)
const visible = async () => { await db.exec('set role authenticated'); try { return (await db.query(`select * from public.push_subscriptions`)).rows.length } finally { await db.exec('reset role') } }
check("another account can't see this account's devices", (await visible()) === 0)
await as(U1)
check('…while the account itself can', (await visible()) === 1)
await as(U2)
await as(U1)
const st = (await db.query(`select public.push_status() as s`)).rows[0].s
check('push_status: the setup not done yet (no key, no timer)', st.key === false && st.timer === false)
// tasks: blocks in Kuala Lumpur (UTC+8). Due at 09:00 local with a 10-minute lead → 08:50 local = 00:50 UTC
const blk = (title, due, start, end, o = {}) => ({ table: 'task', client_uuid: uuid(), payload: taskP({ title, due, timeBlockStart: start ? `${due}T${start}` : '', timeBlockEnd: end ? `${due}T${end}` : '', ...o }), edited_at: 8000, base_rev: null, fields: [...TF, 'timeBlockStart', 'timeBlockEnd', ...Object.keys(o)], field_times: {}, att_up: [], att_rm: [] })
const sid = uuid()
await push([
  blk('Prepare slides', '2026-10-23', '09:00', '10:00'),
  blk('Already done', '2026-10-23', '09:00', '', { state: 'done' }),
  blk('No time', '2026-10-23', '', ''),
  { ...blk('Gym', '2026-10-21', '09:00', '10:00', { recurrence: 'daily', seriesId: sid }), client_uuid: sid },
])
const due = async (at) => (await db.query(`select * from public.due_reminders($1::timestamptz)`, [at])).rows
let d1 = await due('2026-10-23T00:50:00Z')
const titles = d1.map((x) => x.title).sort()
check('at 08:50 in KL (10 min early): the open block and the repeat not created yet — not the done one or one without a time', JSON.stringify(titles) === JSON.stringify(['Gym', 'Prepare slides']), JSON.stringify(titles))
const ps = d1.find((x) => x.title === 'Prepare slides')
check('…in the device\'s language, with the time', ps.body === '09:00–10:00 · Starts in 10 min', ps.body)
check('…tagged like the app tags it', ps.tag.endsWith(':2026-10-23T09:00') && d1.find((x) => x.title === 'Gym').tag === `block:${sid}:2026-10-23T09:00`)
check('not before it\'s due (08:49)', (await due('2026-10-23T00:49:00Z')).length === 0)
check('still sent a few minutes late (08:58), not after 10 minutes', (await due('2026-10-23T00:58:00Z')).length === 2 && (await due('2026-10-23T01:01:00Z')).length === 0)
// a repeat's last day deleted (the task deleted) → no more reminders; skipped (deleted + cancelled) → it goes on
const sDel = uuid(), sSkip = uuid()
await push([
  { ...blk('Deleted repeat', '2026-10-21', '09:00', '', { recurrence: 'daily', seriesId: sDel }), client_uuid: sDel },
  blk('Deleted repeat', '2026-10-22', '09:00', '', { recurrence: 'daily', seriesId: sDel, deleted: 1 }),
  { ...blk('Skipped repeat', '2026-10-21', '09:00', '', { recurrence: 'daily', seriesId: sSkip }), client_uuid: sSkip },
  blk('Skipped repeat', '2026-10-22', '09:00', '', { recurrence: 'daily', seriesId: sSkip, deleted: 1, state: 'cancelled' }),
])
const t2 = (await due('2026-10-23T00:50:00Z')).map((x) => x.title).sort()
check('a repeat whose last day was deleted reminds no more; one whose last day was skipped goes on', t2.includes('Skipped repeat') && !t2.includes('Deleted repeat') && t2.includes('Gym'), JSON.stringify(t2))
await saveSub({ lang: 'zh', lead: 0 })
d1 = await due('2026-10-23T01:00:00Z')
check('lead and language follow the device\'s latest setting', d1.find((x) => x.title === 'Prepare slides')?.body === '09:00–10:00 · 现在开始')
check('the database\'s own timer only: signed-in users can\'t read everyone\'s reminders', await (async () => { await db.exec('set role authenticated'); try { return await refused(() => db.query(`select * from public.due_reminders()`)) } finally { await db.exec('reset role') } })())
// send_due_reminders: nothing without the key; with it, a block due now goes out once
const nowLocal = (await db.query(`select to_char(now() at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD') as d, to_char(now() at time zone 'Asia/Kuala_Lumpur', 'HH24:MI') as t`)).rows[0]
await push([blk('Right now', nowLocal.d, nowLocal.t, '')])
await db.exec(`reset role`)
check('without the push key nothing is sent', (await db.query(`select public.send_due_reminders() as n`)).rows[0].n === 0)
await db.exec(`insert into vault.secrets (name, secret) values ('planner_vapid', '{"kty":"EC","d":"x"}')`)
const n1 = (await db.query(`select public.send_due_reminders() as n`)).rows[0].n
const call = (await db.query(`select * from net.calls`)).rows.at(-1)
check('with it, the block due now goes to the push-reminders function', n1 === 1 && call?.url.endsWith('/functions/v1/push-reminders') && call.body.messages[0].payload.title === 'Right now' && call.body.vapid.d === 'x', JSON.stringify(call?.body?.messages?.map((m) => m.payload.title)))
check('…once (the next minute sends nothing again)', (await db.query(`select public.send_due_reminders() as n`)).rows[0].n === 0)
await db.exec(`insert into net._http_response (id, status_code, content) values (1, 200, '{"planner":1,"sent":0,"gone":["https://fcm.googleapis.com/fcm/send/dev1"],"failed":[]}')`)
await db.query(`select public.send_due_reminders()`)
check('a device the push service reports gone is forgotten', (await db.query(`select * from public.push_subscriptions`)).rows.length === 0)
await as(U1)
}

console.log(`\n${results.filter(Boolean).length}/${results.length} SQL checks passed`)
if (results.some((ok) => !ok)) process.exitCode = 1
