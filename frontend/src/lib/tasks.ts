// Task operations shared by screens.
import { db, patchAndQueue, type Task } from '../db/db'
import { syncNow } from '../sync/engine'

/** Extract a time ("6am") and duration ("2h") from free text — the quick-add
    convenience. Returns the cleaned title plus any values found. */
export function parseExtras(input: string) {
  let title = input.trim()
  let time: string | undefined
  let hours: number | undefined
  const t = title.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (t) {
    let h = parseInt(t[1], 10) % 12
    if (t[3].toLowerCase() === 'pm') h += 12
    time = `${String(h).padStart(2, '0')}:${t[2] ?? '00'}`
    title = title.replace(t[0], '').trim()
  }
  const d = title.match(/\b(\d+(?:\.\d+)?)h\b/i)
  if (d) {
    hours = parseFloat(d[1])
    title = title.replace(d[0], '').trim()
  }
  return { title, time, hours }
}

/** Move tasks to `day` (keeping their time of day), after what's there. */
export async function moveTasksTo(list: Task[], day: string) {
  const there = await db.tasks.where('due').equals(day).and((x) => !x.deleted).toArray()
  let order = Math.max(-1, ...there.map((x) => x.sortOrder ?? 0))
  for (const task of list) {
    const patch: Partial<Task> = { due: day, sortOrder: ++order }
    if (task.timeBlockStart) patch.timeBlockStart = day + task.timeBlockStart.slice(10, 16)
    if (task.timeBlockEnd) patch.timeBlockEnd = day + task.timeBlockEnd.slice(10, 16)
    await patchAndQueue(db.tasks, 'task', task.id, patch)
  }
  syncNow()
}
