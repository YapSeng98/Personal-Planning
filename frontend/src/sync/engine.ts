// Offline-first sync engine (design doc §09).
// UI reads/writes Dexie only; this engine drains the outbox to Supabase and
// applies delta pulls when a connection and a sign-in exist. Offline, or
// signed out, the app keeps working locally and catches up afterwards.

import { db, notifyChange, cleanEmoji, type DrawingNote, type Review, type OutboxEntry, type NoteAttachment } from '../db/db'
import { SYNC_FIELDS, applyAttachmentOps, type SyncTable } from './fields'
import { isAuthed, accountDevice, syncSession, syncPush, syncPull, NetworkError, localDataOwner, setLocalDataOwner, type PushItem } from './api'
import { supabase } from './supabase'
import { syncAiUrl } from '../lib/ai'
import { startUploads, notUploadedIds, lastUploadError, setAfterUpload } from '../lib/files'
import { slimDrawing, slimReview, saveSlimmed, sizeBreakdown, MAX_SLIM_LEVEL } from '../lib/compact'
import { startLiveSync } from './live'

/** 'signed-out': this device's data belongs to an account, but its sign-in
    ended (revoked or expired) — nothing syncs until you sign in again.
    'local-only': the offline demo, never signed in. */
export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'local-only' | 'signed-out'

let listeners: ((s: SyncState, detail?: string) => void)[] = []
let current: SyncState = 'idle'
let currentDetail: string | undefined

export function onSyncState(fn: (s: SyncState, detail?: string) => void) {
  listeners.push(fn)
  fn(current, currentDetail)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}

function setState(s: SyncState, detail?: string) {
  current = s
  currentDetail = detail
  listeners.forEach((l) => l(s, detail))
}

const tableMap = {
  task: db.tasks,
  habit: db.habits,
  habit_log: db.habitLogs,
  goal: db.goals,
  review: db.reviews,
  project: db.projects,
  drawing: db.drawings,
  folder: db.folders,
} as const

// The payload always carries every synced field (sync/fields.ts), '' for
// anything unset — that's what makes CLEARING a field propagate. Which of
// them the server actually applies is decided by `fields` (see pushItem).
function buildPayload(table: keyof typeof tableMap, rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of SYNC_FIELDS[table]) out[f] = rec[f] == null ? '' : rec[f]
  return out
}

// A record bigger than this isn't sent — retrying a doomed huge upload every
// minute just loads the database. The server allows 60s per statement
// (supabase/schema.sql; Supabase's 8s default cancelled 4-6 MB writes).
// Measured after raising it: 8 MB ≈ 20s, 10 MB ≈ 80s or a gateway error —
// so 8 MB is the practical ceiling.
const MAX_RECORD_BYTES = 8 * 1024 * 1024
// Records are pushed in batches up to this size, so one bad record only
// fails its own batch instead of blocking every other change.
const BATCH_BYTES = 1024 * 1024

function describe(table: string, rec: Record<string, unknown>): string {
  const name = rec.title || rec.name || rec.periodStart || ''
  const kind = table === 'drawing' ? 'sketch' : table
  return name ? `${kind} "${String(name).slice(0, 40)}"` : kind
}

/** Outbox entries grouped per record, in queue order. */
function groupEntries(entries: OutboxEntry[]): Map<string, OutboxEntry[]> {
  const m = new Map<string, OutboxEntry[]>()
  for (const e of [...entries].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    const k = `${e.table}:${e.recordId}`
    m.set(k, [...(m.get(k) ?? []), e])
  }
  return m
}

/** Net attachment changes across a record's queued writes. */
function attachmentChanges(group: OutboxEntry[]): { up: Set<string>; rm: Set<string> } {
  const up = new Set<string>(), rm = new Set<string>()
  for (const e of group) {
    for (const id of e.attUp ?? []) { up.add(id); rm.delete(id) }
    for (const id of e.attRm ?? []) { rm.add(id); up.delete(id) }
  }
  return { up, rm }
}

/** What to send for one record: the whole payload (older servers and new
    records need it) plus exactly which fields this device changed, when
    each was last edited here, and the attachment adds/removals — so the
    server applies only those, field by field. Entries queued by an older
    app version don't say what changed: they claim every field, stamped
    with their edit time — so anything edited more recently elsewhere
    still wins on the server. */
function pushItem(table: SyncTable, id: string, rec: Record<string, unknown>, group: OutboxEntry[]): PushItem {
  const all = SYNC_FIELDS[table]
  const legacy = group.some((e) => !e.fields)
  const isNew = group.some((e) => e.fields?.includes('*'))
  const fieldTimes: Record<string, number> = {}
  for (const e of group) {
    for (const f of !e.fields || e.fields.includes('*') ? all : e.fields) fieldTimes[f] = Math.max(fieldTimes[f] ?? 0, e.editedAt)
  }
  const { up, rm } = attachmentChanges(group)
  // A whole-record write (older app version / '*') doesn't say which files
  // it added: offer every file it has — the server only adds, never drops
  // files another device attached (same as for older app versions' pushes).
  if (legacy || isNew) for (const a of (rec.attachments as NoteAttachment[] | undefined) ?? []) up.add(a.id)
  return {
    table,
    client_uuid: id,
    payload: buildPayload(table, rec),
    edited_at: Math.max(...group.map((e) => e.editedAt)),
    base_rev: typeof rec.rev === 'number' ? rec.rev : null,
    fields: legacy || isNew ? all : [...new Set(group.flatMap((e) => e.fields!))],
    field_times: fieldTimes,
    att_up: [...up],
    att_rm: [...rm],
  }
}

/** A pulled record that still has unsent local edits: keep the locally
    edited fields (and attachment adds/removals), take the rest from the
    server. A whole-record local write (new record / older app version)
    keeps the local copy as is. */
function mergePending(table: SyncTable, local: Record<string, unknown>, remote: Record<string, unknown>, group: OutboxEntry[]): Record<string, unknown> {
  if (group.some((e) => !e.fields || e.fields.includes('*'))) return { ...local, rev: remote.rev }
  const dirty = new Set(group.flatMap((e) => e.fields!))
  const out: Record<string, unknown> = { ...local }
  for (const f of SYNC_FIELDS[table]) {
    if (f === 'attachments') {
      const remoteList = (remote.attachments as NoteAttachment[] | undefined) ?? []
      if (dirty.has(f)) {
        const { up, rm } = attachmentChanges(group)
        const localUp = ((local.attachments as NoteAttachment[] | undefined) ?? []).filter((a) => up.has(a.id))
        out.attachments = applyAttachmentOps(remoteList, localUp, [...rm])
      } else {
        out.attachments = remoteList
      }
    } else if (!dirty.has(f)) {
      if (f in remote) out[f] = remote[f]
      else delete out[f]
    }
  }
  out.rev = remote.rev
  return out
}

let running = false
let rerun = false

/** No session to sync as right now (see syncSession) — nothing was sent. */
class NoSession extends Error {}

// Couldn't reach the server (or refresh the sign-in): try again shortly —
// 3s, 6s, 12s, then every 15s — instead of waiting for the next poll.
// (After a failed refresh supabase-js waits a minute before trying again.)
let retryTimer: number | undefined
let retryDelay = 0
function retrySoon() {
  window.clearTimeout(retryTimer)
  retryDelay = Math.min(retryDelay ? retryDelay * 2 : 3000, 15_000)
  retryTimer = window.setTimeout(() => syncNow(), retryDelay)
}

/** Once per device after the 2026-10-07 release, the pull fetches
    everything: pulls made while the sign-in was being refreshed went out
    without it, the server answered "nothing changed", and the device then
    skipped those changes (see syncSession). Merged like any pull, so
    nothing on the device is lost. */
const RESYNC = '2026-10-07'

export async function syncNow(): Promise<void> {
  if (!isAuthed()) {
    setState(accountDevice() ? 'signed-out' : 'local-only')
    return
  }
  if (!navigator.onLine) {
    setState('offline')
    return
  }
  // One sync at a time (the minute timer, auto-save and "Sync now" can all
  // fire together); a request during a run gets one follow-up run.
  if (running) {
    rerun = true
    return
  }
  running = true
  startLiveSync(() => syncNow())
  setState('syncing')
  const problems: string[] = []
  try {
    // Nothing goes to the server without the account's sign-in.
    const sess = await syncSession()
    if (!sess) throw new NoSession()
    // Installs from before ownership was tracked: the data here belongs to
    // whoever is signed in now (one account per device until then).
    if (!localDataOwner()) setLocalDataOwner(sess.uid)
    // 0a. A queued note/review too big to send (saved before files moved to
    // Storage, or with full-size images) gets slimmed first: inline files
    // move to Storage, oversized images shrink. Done before the uploads
    // below so the files it moves go up in this same sync.
    const queued = await db.outbox.toArray()
    const checked = new Set<string>()
    for (const e of queued) {
      const key = `${e.table}:${e.recordId}`
      if (checked.has(key) || (e.table !== 'drawing' && e.table !== 'review')) continue
      checked.add(key)
      const rec = await tableMap[e.table].get(e.recordId)
      if (!rec || JSON.stringify(buildPayload(e.table, rec as never)).length <= MAX_RECORD_BYTES) continue
      try {
        if (e.table === 'drawing') {
          // Squeeze harder step by step until it fits (many compact photos
          // in one note need more than the normal pass).
          let cur = rec as DrawingNote
          for (let level = 0; level <= MAX_SLIM_LEVEL; level++) {
            const slim = await slimDrawing(cur, level)
            if (slim) cur = slim
            if (JSON.stringify(buildPayload('drawing', cur as never)).length <= MAX_RECORD_BYTES) break
          }
          if (cur !== rec) await saveSlimmed('drawing', rec as DrawingNote, cur)
        } else {
          const slim = await slimReview(rec as Review, true)
          if (slim) await saveSlimmed('review', rec as Review, slim)
        }
      } catch {
        // leave it — the size check below reports it
      }
    }

    // 0b. Attachment files upload in the background (lib/files.ts), never
    // inside a sync — a big file on a slow connection mustn't hold up every
    // other change. A file's attachment is held back from the push below
    // until the file is up, so no device is sent a file it can't open.
    startUploads()
    const notUploaded = await notUploadedIds()
    const uploadErr = lastUploadError()
    if (uploadErr) problems.push(`An attachment hasn't uploaded yet (retrying): ${uploadErr}`)
    const heldBack: { table: SyncTable; recordId: string; editedAt: number; attUp: string[] }[] = []

    // 1. Push: drain the outbox.
    const pushedKeys: string[] = [] // "<id>#<rev>" applied this sync — the pull skips them
    const entries = await db.outbox.orderBy('seq').toArray()
    if (entries.length > 0) {
      // One push per record, however many writes are queued for it (an
      // auto-saving form queues one per pause in typing).
      const byRecord = groupEntries(entries)
      const batches: { items: PushItem[]; keys: string[]; bytes: number }[] = []
      const done: string[] = [] // record keys whose entries can be cleared
      for (const [key, group] of byRecord) {
        const e = group[0]
        const rec = await tableMap[e.table].get(e.recordId)
        if (!rec) {
          done.push(key)
          continue
        }
        const item = pushItem(e.table, e.recordId, rec as unknown as Record<string, unknown>, group)
        // Files not uploaded yet: their attachments wait (still queued) —
        // the rest of the record goes now.
        const held = notUploaded.size ? (item.att_up ?? []).filter((id) => notUploaded.has(id)) : []
        if (held.length) {
          item.att_up = item.att_up!.filter((id) => !notUploaded.has(id))
          if (Array.isArray(item.payload.attachments)) {
            item.payload = { ...item.payload, attachments: (item.payload.attachments as NoteAttachment[]).filter((a) => !notUploaded.has(a.id)) }
          }
          const others = (item.fields ?? []).some((f) => f !== 'attachments') || item.att_up.length > 0 || (item.att_rm ?? []).length > 0
          if (!others) continue
          heldBack.push({ table: e.table, recordId: e.recordId, editedAt: item.edited_at, attUp: held })
        }
        const bytes = JSON.stringify(item).length
        if (bytes > MAX_RECORD_BYTES) {
          const where = sizeBreakdown(rec as never)
          problems.push(`${describe(e.table, rec as never)} is too large to sync (${(bytes / 1048576).toFixed(1)} MB${where ? `: ${where}` : ''}) — remove some images or files`)
          continue
        }
        const last = batches[batches.length - 1]
        if (last && last.bytes + bytes <= BATCH_BYTES) {
          last.items.push(item)
          last.keys.push(key)
          last.bytes += bytes
        } else {
          batches.push({ items: [item], keys: [key], bytes })
        }
      }
      let stopped: Error | null = null
      for (const b of batches) {
        // fresh each time: a long push can outlast the token
        const s = await syncSession()
        if (!s || s.uid !== sess.uid) {
          stopped = new NoSession()
          break
        }
        try {
          const res = await syncPush(b.items, s.token)
          const kept = new Set<string>()
          for (const r of res.results) {
            const it = b.items.find((i) => i.client_uuid === r.client_uuid)!
            if (r.outcome === 'rejected') {
              // The id is taken by a record this account can't see. Keep the
              // change queued and say so, rather than drop it silently.
              kept.add(`${it.table}:${r.client_uuid}`)
              problems.push(`Couldn't sync ${describe(it.table, it.payload)}: the server refused it`)
              continue
            }
            // Record the server-assigned sys_id; conflicts (server_won) get
            // overwritten by the pull below.
            const upd: Record<string, unknown> = { sysId: r.sys_id }
            const current = r.outcome === 'applied' && !r.foreign
            // The row's new version, only when this copy now matches it. After
            // a merge with changes made elsewhere (`foreign`) the old version
            // stays until the pull below brings the merged row — if that pull
            // fails, the next push still reports the old base, so the merged
            // row is still fetched rather than skipped as our own echo.
            if (current && r.rev != null) upd.rev = Number(r.rev)
            await tableMap[it.table as keyof typeof tableMap].update(r.client_uuid, upd as never)
            // Skip downloading our own write — keyed by the row's version,
            // which any later write (another device) bumps, so that still
            // comes through. Servers older than field-level merging send no
            // rev and match the edit time instead.
            if (current) pushedKeys.push(r.rev != null ? `${r.client_uuid}#${r.rev}` : `${r.client_uuid}:${it.edited_at}`)
          }
          done.push(...b.keys.filter((k) => !kept.has(k)))
        } catch (err) {
          // unreachable: the rest stays queued — no point trying each batch
          if (err instanceof NetworkError) {
            stopped = err
            break
          }
          const msg = err instanceof Error ? err.message : String(err)
          const what = b.items.length === 1
            ? describe(b.items[0].table, b.items[0].payload)
            : `${b.items.length} changes`
          problems.push(`Couldn't sync ${what}: ${msg}`)
        }
      }
      // Only the entries just pushed — an edit queued mid-push, or a record
      // that failed, stays queued for next time.
      const doneSet = new Set(done)
      const seqs = entries.filter((e) => doneSet.has(`${e.table}:${e.recordId}`)).map((e) => e.seq!)
      const requeue = heldBack.filter((h) => doneSet.has(`${h.table}:${h.recordId}`))
      await db.transaction('rw', db.outbox, async () => {
        await db.outbox.bulkDelete(seqs)
        // attachments held back above wait here for their upload
        if (requeue.length) {
          await db.outbox.bulkAdd(requeue.map((h) => ({ table: h.table, recordId: h.recordId, editedAt: h.editedAt, fields: ['attachments'], attUp: h.attUp, attRm: [] })))
        }
      })
      if (stopped) throw stopped
    }

    // 2. Pull: apply everything changed since our cursor — only ever as the
    // account (a pull without its sign-in must never move the cursor on).
    const ps = await syncSession()
    if (!ps || ps.uid !== sess.uid) throw new NoSession()
    const full = (await db.meta.get('resync'))?.value !== RESYNC
    const cursorMeta = full ? undefined : await db.meta.get('syncCursor')
    const pull = await syncPull(cursorMeta?.value ?? '1970-01-01 00:00:00', pushedKeys, ps.token)
    // Applied in one local transaction with the outbox, so an edit made on
    // this device meanwhile lands either before it (and is merged below) or
    // after it — never in between, where the pulled copy would overwrite
    // it. The cursor is saved in the same transaction: all or nothing.
    await db.transaction('rw', [...Object.values(tableMap), db.outbox, db.meta], async () => {
      // Records with local edits not yet sent (made during the push above, or
      // in a batch that failed) are merged field by field: the fields edited
      // here keep their local value (the next push sends them), everything
      // else takes the server's — so neither side's changes are lost.
      const pending = groupEntries(await db.outbox.toArray())
      for (const r of pull.records) {
        const table = tableMap[r.table as keyof typeof tableMap]
        if (!table) continue
        const local = (await table.get(r.client_uuid)) as { updatedAt?: number; emoji?: string } | undefined
        const data = r.data as Record<string, unknown>
        // A field the server doesn't send at all (as opposed to sending null)
        // means its schema predates that field — schema.sql not re-run yet.
        // Keep the local value instead of letting the pull wipe it. Must run
        // before the null-stripping below, which would make a cleared field
        // look missing.
        for (const f of SYNC_FIELDS[r.table as keyof typeof tableMap]) {
          const lv = (local as Record<string, unknown> | undefined)?.[f]
          if (f !== 'deleted' && !(f in data) && lv !== undefined) data[f] = lv
        }
        // Postgres sends empty columns as null; the app's records model "not
        // set" as a missing key (fields are optional, never null). A stray null
        // breaks checks like `reminderDaysBefore !== undefined` — it made every
        // synced task without a reminder reopen as "remind on due day".
        for (const k of Object.keys(data)) if (data[k] === null) delete data[k]
        if (data.rev != null) data.rev = Number(data.rev)
        if (r.table === 'task') {
          // hours come back as strings from ServiceNow; normalise to number|undefined
          for (const k of ['estimatedHours', 'actualHours'] as const) {
            const v = data[k]
            data[k] = v === '' || v == null ? undefined : Number(v)
          }
        }
        if (r.deleted) {
          if (r.table === 'task' && (data.seriesId || (local as { seriesId?: string } | undefined)?.seriesId)) {
            // Keep a tombstone for recurring occurrences: their ids are derived
            // from series + date (uuidFrom), so with the row gone this device
            // would regenerate — and resurrect — the occurrence just deleted.
            await table.put({ ...(local ?? {}), ...data, id: r.client_uuid, sysId: r.sys_id, deleted: 1 } as never)
          } else {
            await table.delete(r.client_uuid)
          }
        } else {
          if (r.table === 'habit') {
            // The app has no "deactivate" — a non-deleted habit is active.
            // Guards against a ServiceNow boolean round-trip quirk that can
            // return active:0 and make the habit vanish.
            data.active = 1
            // Keep a good local emoji if the server's came back mangled;
            // otherwise fall back to a name-based guess so it never shows garbage.
            const emojiOk = (s: unknown) => /\p{Extended_Pictographic}/u.test(String(s ?? ''))
            if (!emojiOk(data.emoji)) {
              data.emoji = local?.emoji && emojiOk(local.emoji)
                ? local.emoji
                : cleanEmoji(String(data.emoji ?? ''), String(data.name ?? ''))
            }
          }
          const group = pending.get(`${r.table}:${r.client_uuid}`)
          const merged = group && local
            ? mergePending(r.table as SyncTable, local as Record<string, unknown>, data, group)
            : { ...data }
          await table.put({ ...merged, id: r.client_uuid, sysId: r.sys_id } as never)
        }
      }
      await db.meta.put({ key: 'syncCursor', value: pull.cursor })
      if (full) await db.meta.put({ key: 'resync', value: RESYNC })
    })
    const aiChanged = await syncAiUrl().catch(() => false)
    if (pull.records.length > 0 || aiChanged) notifyChange()
    retryDelay = 0
    if (problems.length) setState('error', problems.join('\n'))
    else setState('idle')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!isAuthed()) {
      // the sign-in ended during this sync (revoked, or another tab signed out)
      setState(accountDevice() ? 'signed-out' : 'local-only')
    } else if (err instanceof NoSession || err instanceof NetworkError) {
      // offline for a moment (typical right after the device wakes) — not an error
      setState('offline', "Couldn't reach the server — trying again shortly")
      retrySoon()
    } else {
      setState('error', [msg, ...problems].join('\n'))
    }
  } finally {
    running = false
    if (rerun) {
      rerun = false
      syncNow()
    }
  }
}

export function startSyncLoop() {
  // The sign-in can end in the background (a refresh token revoked or
  // expired — the session is then dropped): say so at once, not just stop.
  supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') syncNow() })
  // …or in another tab of this browser (signing in there resumes here too)
  window.addEventListener('storage', (e) => { if (e.key === null || e.key.endsWith('-auth-token')) syncNow() })
  // a finished upload sends the attachment that was waiting for it
  setAfterUpload(() => { syncNow() })
  syncNow()
  window.addEventListener('online', () => syncNow())
  window.addEventListener('offline', () => setState('offline'))
  // Coming back to the app (tab switch, unlocking the phone) catches up at
  // once rather than at the next poll.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow() })
  window.addEventListener('focus', () => syncNow())
  // Changes from other devices arrive within a second or two over
  // Realtime; the poll stays as a safety net if the socket drops.
  startLiveSync(() => syncNow())
  setInterval(syncNow, 60_000)
}
