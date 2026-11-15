// A copy of everything on this device as one file (Settings → Backup) — a
// safety net next to the sync, readable anywhere (JSON). Removed records
// aren't in it; big files kept online (Supabase Storage) are listed in their
// notes' attachments but not copied in. Restore brings back what's in a
// backup and missing here; it never changes or removes anything that is.
import { db, todayStr, patchAndQueue, writeAndQueue, rollUpGoal } from '../db/db'
import type { Table } from 'dexie'
import type { SyncTable } from '../sync/fields'
import { syncNow } from '../sync/engine'
import { restoreItem, type BinKind } from './bin'

export interface BackupResult { file: string; bytes: number; counts: Record<string, number> }

export async function downloadBackup(app: { version: string; account?: string | null }): Promise<BackupResult> {
  const tables: [string, Table<{ deleted?: unknown }, string>][] = [
    ['tasks', db.tasks], ['goals', db.goals], ['habits', db.habits], ['habitLogs', db.habitLogs],
    ['reviews', db.reviews], ['projects', db.projects], ['sketches', db.drawings], ['folders', db.folders],
  ] as unknown as [string, Table<{ deleted?: unknown }, string>][]
  const out: Record<string, unknown> = { app: 'Planner', format: 1, version: app.version, account: app.account ?? undefined, exportedAt: new Date().toISOString() }
  const counts: Record<string, number> = {}
  for (const [name, table] of tables) {
    const rows = (await table.toArray()).filter((r) => !r.deleted)
    out[name] = rows
    counts[name] = rows.length
  }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' })
  const file = `planner-backup-${todayStr()}.json`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file
  document.body.appendChild(a)
  a.click()
  a.remove()
  // the browser has the file by now; let the memory go a little later
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return { file, bytes: blob.size, counts }
}

/** 12.3 MB / 840 KB */
export function sizeLabel(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

type Key = 'tasks' | 'goals' | 'habits' | 'habitLogs' | 'reviews' | 'projects' | 'sketches' | 'folders'
type Row = Record<string, unknown> & { id: string; updatedAt: number; deleted?: 0 | 1 }
/** Backup key → synced table; parents before what points at them. */
const TABLES: [Key, SyncTable, Table<Row, string>][] = [
  ['projects', 'project', db.projects], ['folders', 'folder', db.folders], ['goals', 'goal', db.goals],
  ['habits', 'habit', db.habits], ['habitLogs', 'habit_log', db.habitLogs], ['tasks', 'task', db.tasks],
  ['sketches', 'drawing', db.drawings], ['reviews', 'review', db.reviews],
] as unknown as [Key, SyncTable, Table<Row, string>][]
const BIN_KIND: Partial<Record<SyncTable, BinKind>> = { task: 'task', goal: 'goal', habit: 'habit', project: 'project', drawing: 'note', folder: 'folder', review: 'review' }

const str = (v: unknown) => typeof v === 'string'
const oneOf = (v: unknown, list: string[]) => list.includes(v as string)
/** Enough of each record's shape that the app can show it. */
const VALID: Record<Key, (r: Row) => boolean> = {
  tasks: (r) => str(r.title) && oneOf(r.state, ['open', 'in_progress', 'done', 'cancelled']),
  goals: (r) => str(r.title) && oneOf(r.type, ['vision', 'year', 'quarter', 'month', 'week']),
  habits: (r) => str(r.name) && typeof r.targetPerDay === 'number',
  habitLogs: (r) => str(r.habitId) && str(r.date) && typeof r.count === 'number',
  reviews: (r) => oneOf(r.type, ['daily', 'weekly', 'monthly', 'yearly']) && str(r.periodStart) && str(r.periodEnd),
  projects: (r) => str(r.title),
  sketches: (r) => str(r.title) && (r.kind == null || oneOf(r.kind, ['draw', 'text'])),
  folders: (r) => str(r.name),
}

export interface RestorePlan {
  exportedAt?: string
  account?: string
  /** what comes back: missing here, or deleted here (then just undeleted — the copy here is newer) */
  rows: { key: Key; name: SyncTable; table: Table<Row, string>; row: Row; revive: boolean }[]
  bring: Partial<Record<Key, number>>
  already: number
  skipped: number
}

export class NotBackup extends Error {}

/** Read a backup file and work out what it would bring back. Run it on a
    device that's just synced: "missing here" must mean missing from the
    account, not just not downloaded yet. */
export async function readBackup(file: Blob): Promise<RestorePlan> {
  let json: Record<string, unknown>
  try { json = JSON.parse(await file.text()) } catch { throw new NotBackup() }
  if (!json || typeof json !== 'object' || json.app !== 'Planner' || json.format !== 1) throw new NotBackup()
  const plan: RestorePlan = {
    exportedAt: str(json.exportedAt) ? json.exportedAt as string : undefined,
    account: str(json.account) ? json.account as string : undefined,
    rows: [], bring: {}, already: 0, skipped: 0,
  }
  for (const [key, name, table] of TABLES) {
    const rows = Array.isArray(json[key]) ? json[key] as Row[] : []
    for (const row of rows) {
      if (!row || typeof row !== 'object' || !str(row.id) || row.deleted || !VALID[key](row)) { plan.skipped++; continue }
      const here = await table.get(row.id)
      if (here && !here.deleted) { plan.already++; continue }
      plan.rows.push({ key, name, table, row, revive: !!here })
      plan.bring[key] = (plan.bring[key] ?? 0) + 1
    }
  }
  return plan
}

/** Bring back what the plan found, then sync. */
export async function applyRestore(plan: RestorePlan, progress?: (done: number, total: number) => void): Promise<number> {
  const goals = new Set<string>()
  let done = 0
  for (const { name, table, row, revive } of plan.rows) {
    const kind = BIN_KIND[name]
    if (revive && kind) await restoreItem({ kind, id: row.id })
    else if (revive) await patchAndQueue(table, name, row.id, { deleted: 0 })
    else {
      const { rev: _rev, sysId: _sysId, ...rest } = row
      await writeAndQueue(table, name, { ...rest, deleted: 0, ...(name === 'habit' ? { active: 1 } : {}), updatedAt: Date.now() } as Row)
      if (name === 'task' && str(row.goalId)) goals.add(row.goalId as string)
      if (name === 'goal') goals.add(row.id)
    }
    progress?.(++done, plan.rows.length)
  }
  for (const id of goals) await rollUpGoal(id)
  syncNow()
  return done
}
