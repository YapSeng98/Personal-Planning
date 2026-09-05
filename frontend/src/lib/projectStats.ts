import { db, todayStr, type ProjectColor } from '../db/db'

export interface ProjectStat {
  id: string
  title: string
  color: ProjectColor
  done: number
  /** open + in_progress + done — cancelled tasks don't count toward the rate. */
  total: number
  pct: number
  /** Completions per day, oldest first, for the last `days` calendar days. */
  spark: number[]
  weekDone: number
  prevWeekDone: number
  /** Has open/in-progress work but no completion in `staleDays` days (or ever). */
  stalled: boolean
  /** Days since the last completion, or null if the project has never had one. */
  daysSinceLastDone: number | null
}

/** Per-project completion + velocity for the Board's project-overview strip.
    Completion day comes from Task.completedAt, falling back to updatedAt for
    tasks done before that field existed (or synced in from a device that
    doesn't set it) — see Task.completedAt's doc comment in db.ts. */
export async function computeProjectStats(staleDays = 10, days = 7): Promise<ProjectStat[]> {
  const projects = await db.projects.filter((p) => !p.deleted && !p.archived).toArray()
  const tasks = await db.tasks.filter((t) => !t.deleted && !!t.projectId && t.state !== 'cancelled').toArray()

  const byProject = new Map<string, typeof tasks>()
  for (const t of tasks) {
    const arr = byProject.get(t.projectId!) ?? []
    arr.push(t)
    byProject.set(t.projectId!, arr)
  }

  const dayKey = (i: number) => todayStr(new Date(Date.now() - i * 86400_000))
  const last = Array.from({ length: days }, (_, i) => dayKey(days - 1 - i)) // oldest..today
  const prev = Array.from({ length: days }, (_, i) => dayKey(2 * days - 1 - i)) // the window just before

  return projects.map((p) => {
    const all = byProject.get(p.id) ?? []
    const done = all.filter((t) => t.state === 'done')
    const doneAt = done.map((t) => t.completedAt ?? t.updatedAt)
    const doneDays = doneAt.map((ts) => todayStr(new Date(ts)))
    const countOn = (d: string) => doneDays.filter((x) => x === d).length

    const spark = last.map(countOn)
    const weekDone = spark.reduce((s, v) => s + v, 0)
    const prevWeekDone = prev.reduce((s, d) => s + countOn(d), 0)

    const hasOpenWork = all.some((t) => t.state === 'open' || t.state === 'in_progress')
    // Floor of the raw ms gap, not a day-string round-trip (which would
    // round midnight-of-that-day vs. "now" instead of the actual gap, off
    // by up to a day depending on time of day).
    const daysSinceLastDone = doneAt.length ? Math.floor((Date.now() - Math.max(...doneAt)) / 86400_000) : null
    // A project that has NEVER had a completion is "new", not stalled — stalled
    // means progress happened and then stopped, which needs at least one done
    // task to be true. Without this, every freshly created project (open tasks,
    // zero completions) would read as stalled from the moment it's created.
    const stalled = done.length > 0 && hasOpenWork && daysSinceLastDone !== null && daysSinceLastDone >= staleDays

    return {
      id: p.id,
      title: p.title,
      color: p.color,
      done: done.length,
      total: all.length,
      pct: all.length ? Math.round((done.length / all.length) * 100) : 0,
      spark,
      weekDone,
      prevWeekDone,
      stalled,
      daysSinceLastDone,
    }
  })
}
