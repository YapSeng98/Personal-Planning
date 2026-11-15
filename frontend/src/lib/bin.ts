// Recently deleted (Settings → Recently deleted): everything deleted in the
// last 30 days, on every device, with Restore. A delete has always been a
// tombstone (deleted) on the server with the record intact; devices now keep
// it for 30 days too (sync/engine.ts pull) and clear it after — together with
// a note's or review's stored files, which stay until then so a restored
// note comes back whole.
import type { Table } from 'dexie'
import { db, patchAndQueue, rollUpGoal, todayStr, BIN_MS, type Task, type Goal, type Habit, type Project, type DrawingNote, type SketchFolder, type Review, type NoteAttachment } from '../db/db'
import type { SyncTable } from '../sync/fields'
import { syncNow, onSyncState } from '../sync/engine'
import { deleteStoredFiles } from './files'

export const BIN_DAYS = BIN_MS / 86_400_000

export type BinKind = 'task' | 'goal' | 'habit' | 'project' | 'note' | 'folder' | 'review'

export interface BinItem {
  kind: BinKind
  id: string
  title: string
  /** what the page shows beside the title: a task's day, a goal's level, a review's type… */
  detail?: string
  emoji?: string
  deletedAt: number
  /** files kept online with it (they go when it leaves the bin) */
  files: number
}

type Row = { id: string; deleted?: 0 | 1; updatedAt?: number; attachments?: NoteAttachment[]; seriesId?: string }
const recent = <T extends Row>(table: Table<T, string>, cutoff: number) =>
  table.filter((x) => !!x.deleted && (x.updatedAt ?? 0) >= cutoff).toArray()
const stored = (list?: NoteAttachment[]) => (list ?? []).filter((a) => a.stored).length

/** What's in the bin, newest first. */
export async function binItems(): Promise<BinItem[]> {
  const cutoff = Date.now() - BIN_MS
  const [tasks, goals, habits, projects, notes, folders, reviews] = await Promise.all([
    recent<Task>(db.tasks, cutoff), recent<Goal>(db.goals, cutoff), recent<Habit>(db.habits, cutoff),
    recent<Project>(db.projects, cutoff), recent<DrawingNote>(db.drawings, cutoff),
    recent<SketchFolder>(db.folders, cutoff), recent<Review>(db.reviews, cutoff),
  ])
  // a task with a live twin (same title, day and time) was a duplicate the
  // app removed (dedupeRecurringOccurrences) — bringing it back would only
  // see it removed again
  const twin = (t: Task) => `${t.title}|${t.due}|${t.timeBlockStart?.slice(11, 16) ?? ''}`
  const live = tasks.length ? new Set((await db.tasks.filter((t) => !t.deleted && !!t.due).toArray()).map(twin)) : new Set<string>()
  const items: BinItem[] = [
    ...tasks.filter((x) => !live.has(twin(x))).map((x) => ({ kind: 'task' as const, id: x.id, title: x.title, detail: x.due, deletedAt: x.updatedAt, files: 0 })),
    ...goals.map((x) => ({ kind: 'goal' as const, id: x.id, title: x.title, detail: x.type, deletedAt: x.updatedAt, files: 0 })),
    ...habits.map((x) => ({ kind: 'habit' as const, id: x.id, title: x.name, emoji: x.emoji, deletedAt: x.updatedAt, files: 0 })),
    ...projects.map((x) => ({ kind: 'project' as const, id: x.id, title: x.title, deletedAt: x.updatedAt, files: 0 })),
    ...notes.map((x) => ({ kind: 'note' as const, id: x.id, title: x.title, detail: x.kind ?? 'draw', deletedAt: x.updatedAt, files: stored(x.attachments) })),
    ...folders.map((x) => ({ kind: 'folder' as const, id: x.id, title: x.name, deletedAt: x.updatedAt ?? 0, files: 0 })),
    ...reviews.map((x) => ({ kind: 'review' as const, id: x.id, title: x.periodStart, detail: x.type, deletedAt: x.updatedAt, files: stored(x.attachments) })),
  ]
  return items.sort((a, b) => b.deletedAt - a.deletedAt)
}

/** Put it back where it was. A skipped day of a repeat comes back as an open
    task; a note or folder whose folder is gone too comes back at the top. */
export async function restoreItem(item: Pick<BinItem, 'kind' | 'id'>): Promise<void> {
  const { id } = item
  const live = async (folderId?: string) => { const f = folderId ? await db.folders.get(folderId) : undefined; return !!f && !f.deleted }
  switch (item.kind) {
    case 'task': {
      const t = await patchAndQueue(db.tasks, 'task', id, (cur): Partial<Task> => ({ deleted: 0, ...(cur.seriesId && cur.state === 'cancelled' ? { state: 'open' as const } : {}) }))
      if (t?.goalId) await rollUpGoal(t.goalId)
      break
    }
    case 'goal':
      if (await patchAndQueue(db.goals, 'goal', id, { deleted: 0 })) await rollUpGoal(id)
      break
    case 'habit':
      await patchAndQueue(db.habits, 'habit', id, { deleted: 0, active: 1 })
      break
    case 'project':
      await patchAndQueue(db.projects, 'project', id, { deleted: 0 })
      break
    case 'note': {
      const cur = await db.drawings.get(id)
      const inFolder = await live(cur?.folderId)
      await patchAndQueue(db.drawings, 'drawing', id, { deleted: 0, ...(inFolder ? {} : { folderId: undefined }) })
      break
    }
    case 'folder': {
      const cur = await db.folders.get(id)
      const inParent = await live(cur?.parentId)
      await patchAndQueue(db.folders, 'folder', id, { deleted: 0, ...(inParent ? {} : { parentId: undefined }) })
      break
    }
    case 'review':
      await patchAndQueue(db.reviews, 'review', id, { deleted: 0 })
      break
  }
  syncNow()
}

const TABLES: [SyncTable, Table<Row, string>][] = [
  ['task', db.tasks], ['goal', db.goals], ['habit', db.habits], ['habit_log', db.habitLogs], ['project', db.projects],
  ['drawing', db.drawings], ['folder', db.folders], ['review', db.reviews],
] as unknown as [SyncTable, Table<Row, string>][]

/** Clear what's been in the bin over 30 days: the device's copy, and a note's
    or review's stored files (online too). Kept: a repeat's days (their ids
    come back from the series + date — the tombstone stops a deleted day
    being made again) and anything with a change not sent yet. */
export async function purgeBin(): Promise<number> {
  const cutoff = Date.now() - BIN_MS
  const queued = new Set((await db.outbox.toArray()).map((e) => `${e.table}:${e.recordId}`))
  let n = 0
  for (const [name, table] of TABLES) {
    const old = await table.filter((x) => !!x.deleted && (x.updatedAt ?? 0) < cutoff).toArray()
    for (const r of old) {
      if ((name === 'task' && r.seriesId) || queued.has(`${name}:${r.id}`)) continue
      // files that couldn't be removed online (offline, signed out) wait for next time
      if ((name === 'drawing' || name === 'review') && !(await deleteStoredFiles(r.attachments))) continue
      await table.delete(r.id)
      n++
    }
  }
  return n
}

/** Once a day, after a sync has gone through (so a restore made on another
    device has arrived) — or straight away in the offline demo. */
export function startBinCleanup() {
  let synced = false
  let done = ''
  onSyncState((s) => {
    if (s === 'syncing') { synced = true; return }
    if (!((s === 'idle' && synced) || s === 'local-only') || done === todayStr()) return
    done = todayStr()
    purgeBin().catch(() => { done = '' })
  })
}
