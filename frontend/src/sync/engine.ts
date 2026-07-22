// Offline-first sync engine (design doc §09).
// UI reads/writes Dexie only; this engine drains the outbox to ServiceNow
// and applies delta pulls when a connection and login exist. If the SN side
// isn't built yet (404) or we're offline, the app keeps working locally.

import { db, notifyChange, cleanEmoji } from '../db/db'
import { isAuthed, syncPush, syncPull, type PushItem } from './api'

export type SyncState = 'idle' | 'syncing' | 'offline' | 'error' | 'local-only'

let listeners: ((s: SyncState, detail?: string) => void)[] = []
let current: SyncState = 'idle'

export function onSyncState(fn: (s: SyncState, detail?: string) => void) {
  listeners.push(fn)
  fn(current)
  return () => {
    listeners = listeners.filter((l) => l !== fn)
  }
}

function setState(s: SyncState, detail?: string) {
  current = s
  listeners.forEach((l) => l(s, detail))
}

const tableMap = {
  task: db.tasks,
  habit: db.habits,
  habit_log: db.habitLogs,
  goal: db.goals,
  review: db.reviews,
  project: db.projects,
} as const

export async function syncNow(): Promise<void> {
  if (!isAuthed()) {
    setState('local-only')
    return
  }
  if (!navigator.onLine) {
    setState('offline')
    return
  }
  setState('syncing')
  try {
    // 1. Push: drain the outbox, newest edit per record wins locally.
    const entries = await db.outbox.orderBy('seq').toArray()
    if (entries.length > 0) {
      const items: PushItem[] = []
      for (const e of entries) {
        const rec = await tableMap[e.table].get(e.recordId)
        if (rec) {
          items.push({
            table: e.table,
            client_uuid: e.recordId,
            payload: rec as unknown as Record<string, unknown>,
            edited_at: e.editedAt,
          })
        }
      }
      const res = await syncPush(items)
      for (const r of res.results) {
        // Record the server-assigned sys_id; conflicts (server_won) get
        // overwritten by the pull below.
        await tableMap[entries.find((e) => e.recordId === r.client_uuid)!.table].update(
          r.client_uuid,
          { sysId: r.sys_id } as never,
        )
      }
      await db.outbox.clear()
    }

    // 2. Pull: apply everything changed since our cursor.
    const cursorMeta = await db.meta.get('syncCursor')
    const pull = await syncPull(cursorMeta?.value ?? '1970-01-01 00:00:00')
    for (const r of pull.records) {
      const table = tableMap[r.table as keyof typeof tableMap]
      if (!table) continue
      // Client-side LWW guard: never let an older server copy clobber a
      // newer local one (e.g. a local goal roll-up racing a pull). The
      // server wins later once its copy is genuinely newer.
      const local = (await table.get(r.client_uuid)) as { updatedAt?: number; emoji?: string } | undefined
      const data = r.data as Record<string, unknown>
      const serverAt = Number(data.updatedAt ?? 0)
      if (local?.updatedAt && local.updatedAt > serverAt) continue
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
    if (pull.records.length > 0) notifyChange()
    setState('idle')
  } catch (err) {
    // 404 = SN endpoints not deployed yet; stay usable, just local.
    const msg = err instanceof Error ? err.message : String(err)
    setState(msg.includes('404') ? 'local-only' : 'error', msg)
  }
}

export function startSyncLoop() {
  syncNow()
  window.addEventListener('online', () => syncNow())
  window.addEventListener('offline', () => setState('offline'))
  setInterval(syncNow, 60_000)
}
