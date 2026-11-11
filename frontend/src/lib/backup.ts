// A copy of everything on this device as one file (Settings → Backup) — a
// safety net next to the sync, readable anywhere (JSON). Removed records
// aren't in it; big files kept online (Supabase Storage) are listed in their
// notes' attachments but not copied in.
import { db, todayStr } from '../db/db'
import type { Table } from 'dexie'

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
