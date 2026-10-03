// Offline-first sync engine (design doc §09).
// UI reads/writes Dexie only; this engine drains the outbox to ServiceNow
// and applies delta pulls when a connection and login exist. If the SN side
// isn't built yet (404) or we're offline, the app keeps working locally.

import { db, notifyChange, cleanEmoji } from '../db/db'
import { isAuthed, syncPush, syncPull, type PushItem } from './api'
import { syncAiUrl } from '../lib/ai'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'local-only'

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

// Every syncable field per table (matches the ServiceNow FIELD_MAPS). We push
// ALL of these every time, sending '' for anything the local record doesn't
// have — that's what makes CLEARING a field (time block, notes, hours, a goal
// link…) actually propagate. If we only sent the keys that were present, a
// cleared value would simply be omitted and the server would keep the old one.
const SYNC_FIELDS: Record<keyof typeof tableMap, string[]> = {
  task: ['title', 'notes', 'state', 'priority', 'due', 'timeBlockStart', 'timeBlockEnd',
    'estimatedHours', 'actualHours', 'goalId', 'projectId', 'isMit', 'sortOrder',
    'reminderDaysBefore', 'recurrence', 'seriesId', 'deleted'],
  habit: ['name', 'emoji', 'frequency', 'targetPerDay', 'active', 'deleted'],
  habit_log: ['habitId', 'date', 'count', 'deleted'],
  goal: ['title', 'type', 'parentId', 'lifeArea', 'whyItMatters', 'progress', 'status', 'targetDate', 'deleted'],
  review: ['type', 'periodStart', 'periodEnd', 'wins', 'failures', 'lesson', 'mood', 'energy', 'nextPriorities', 'attachments', 'deleted'],
  project: ['title', 'color', 'archived', 'deleted'],
  drawing: ['title', 'kind', 'dataUrl', 'text', 'format', 'attachments', 'folderId', 'deleted'],
  folder: ['name', 'parentId', 'cover', 'coverY', 'coverH', 'deleted'],
}

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

let running = false
let rerun = false

export async function syncNow(): Promise<void> {
  if (!isAuthed()) {
    setState('local-only')
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
  setState('syncing')
  const problems: string[] = []
  try {
    // 1. Push: drain the outbox.
    const entries = await db.outbox.orderBy('seq').toArray()
    if (entries.length > 0) {
      // One push per record: an auto-saving form queues an entry per pause
      // in typing, and each would otherwise re-send the whole record
      // (attachments included). The record itself is read fresh below, so
      // only the latest entry's editedAt matters.
      const latest = new Map<string, (typeof entries)[number]>()
      for (const e of entries) latest.set(`${e.table}:${e.recordId}`, e)
      const batches: { items: PushItem[]; keys: string[]; bytes: number }[] = []
      const done: string[] = [] // record keys whose entries can be cleared
      for (const [key, e] of latest) {
        const rec = await tableMap[e.table].get(e.recordId)
        if (!rec) {
          done.push(key)
          continue
        }
        const item: PushItem = {
          table: e.table,
          client_uuid: e.recordId,
          payload: buildPayload(e.table, rec as unknown as Record<string, unknown>),
          edited_at: e.editedAt,
        }
        const bytes = JSON.stringify(item).length
        if (bytes > MAX_RECORD_BYTES) {
          problems.push(`${describe(e.table, rec as never)} is too large to sync (${(bytes / 1048576).toFixed(1)} MB) — remove some images or files`)
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
      for (const b of batches) {
        try {
          const res = await syncPush(b.items)
          for (const r of res.results) {
            // Record the server-assigned sys_id; conflicts (server_won) get
            // overwritten by the pull below.
            const it = b.items.find((i) => i.client_uuid === r.client_uuid)!
            await tableMap[it.table as keyof typeof tableMap].update(r.client_uuid, { sysId: r.sys_id } as never)
          }
          done.push(...b.keys)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('404')) throw err
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
      await db.outbox.bulkDelete(seqs)
    }

    // 2. Pull: apply everything changed since our cursor.
    const cursorMeta = await db.meta.get('syncCursor')
    const pull = await syncPull(cursorMeta?.value ?? '1970-01-01 00:00:00')
    // Records edited locally since the push above (still queued) are newer
    // than anything the server has — their next push will carry them.
    const pending = new Set((await db.outbox.toArray()).map((e) => `${e.table}:${e.recordId}`))
    for (const r of pull.records) {
      const table = tableMap[r.table as keyof typeof tableMap]
      if (!table) continue
      if (pending.has(`${r.table}:${r.client_uuid}`)) continue
      // Client-side LWW guard: never let an older server copy clobber a
      // newer local one (e.g. a local goal roll-up racing a pull). The
      // server wins later once its copy is genuinely newer.
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
      const serverAt = Number(data.updatedAt ?? 0)
      if (local?.updatedAt && local.updatedAt > serverAt) continue
      if (r.table === 'task') {
        // hours come back as strings from ServiceNow; normalise to number|undefined
        for (const k of ['estimatedHours', 'actualHours'] as const) {
          const v = data[k]
          data[k] = v === '' || v == null ? undefined : Number(v)
        }
      }
      if (r.deleted) {
        await table.delete(r.client_uuid)
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
        await table.put({ ...data, id: r.client_uuid, sysId: r.sys_id } as never)
      }
    }
    await db.meta.put({ key: 'syncCursor', value: pull.cursor })
    const aiChanged = await syncAiUrl().catch(() => false)
    if (pull.records.length > 0 || aiChanged) notifyChange()
    if (problems.length) setState('error', problems.join('\n'))
    else setState('idle')
  } catch (err) {
    // 404 = SN endpoints not deployed yet; stay usable, just local.
    const msg = err instanceof Error ? err.message : String(err)
    setState(msg.includes('404') ? 'local-only' : 'error', [msg, ...problems].join('\n'))
  } finally {
    running = false
    if (rerun) {
      rerun = false
      syncNow()
    }
  }
}

export function startSyncLoop() {
  syncNow()
  window.addEventListener('online', () => syncNow())
  window.addEventListener('offline', () => setState('offline'))
  setInterval(syncNow, 60_000)
}
