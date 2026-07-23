import Dexie, { type Table } from 'dexie'

// Local mirror of the x_pps_* ServiceNow tables (design doc §04/§09).
// `id` is the client_uuid used for idempotent sync; `sysId` arrives after
// the record first reaches ServiceNow. `deleted` is the soft-delete tombstone.

export type TaskState = 'open' | 'in_progress' | 'done' | 'cancelled'

export interface Task {
  id: string
  sysId?: string
  title: string
  notes?: string
  state: TaskState
  /** 1 critical … 5 optional */
  priority: number
  /** YYYY-MM-DD */
  due?: string
  timeBlockStart?: string // ISO datetime
  timeBlockEnd?: string
  estimatedHours?: number
  actualHours?: number
  goalId?: string
  projectId?: string
  isMit?: boolean
  /** Manual drag order within a day / board column. Lower = higher up. */
  sortOrder?: number
  deleted: 0 | 1
  updatedAt: number
}

/** Order tasks by manual sortOrder, then time block, then id (stable). */
export function byOrder(a: Task, b: Task): number {
  const ao = a.sortOrder ?? 0
  const bo = b.sortOrder ?? 0
  if (ao !== bo) return ao - bo
  const at = a.timeBlockStart ?? 'z'
  const bt = b.timeBlockStart ?? 'z'
  if (at !== bt) return at.localeCompare(bt)
  return a.id.localeCompare(b.id)
}

export interface Habit {
  id: string
  sysId?: string
  name: string
  emoji: string
  frequency: 'daily' | 'weekly'
  targetPerDay: number
  active: 0 | 1
  deleted: 0 | 1
  updatedAt: number
}

export interface HabitLog {
  id: string
  sysId?: string
  habitId: string
  /** YYYY-MM-DD */
  date: string
  count: number
  deleted: 0 | 1
  updatedAt: number
}

export type GoalType = 'vision' | 'year' | 'quarter' | 'month' | 'week'

export interface Goal {
  id: string
  sysId?: string
  title: string
  type: GoalType
  parentId?: string
  lifeArea?: string
  whyItMatters?: string
  progress: number
  status: 'not_started' | 'in_progress' | 'at_risk' | 'completed' | 'abandoned'
  targetDate?: string
  deleted: 0 | 1
  updatedAt: number
}

export type ProjectColor = 'coral' | 'green' | 'blue' | 'purple' | 'teal' | 'gray'

export interface Project {
  id: string
  sysId?: string
  title: string
  color: ProjectColor
  archived: 0 | 1
  deleted: 0 | 1
  updatedAt: number
}

export interface Review {
  id: string
  sysId?: string
  type: 'daily' | 'weekly' | 'monthly' | 'yearly'
  periodStart: string
  periodEnd: string
  wins?: string
  failures?: string
  lesson?: string
  mood?: 'great' | 'good' | 'okay' | 'bad'
  energy?: number
  nextPriorities?: string
  deleted: 0 | 1
  updatedAt: number
}

export interface OutboxEntry {
  seq?: number
  table: 'task' | 'habit' | 'habit_log' | 'goal' | 'review' | 'project'
  recordId: string
  editedAt: number
}

export interface Meta {
  key: string
  value: string
}

class PlannerDB extends Dexie {
  tasks!: Table<Task, string>
  habits!: Table<Habit, string>
  habitLogs!: Table<HabitLog, string>
  goals!: Table<Goal, string>
  reviews!: Table<Review, string>
  projects!: Table<Project, string>
  outbox!: Table<OutboxEntry, number>
  meta!: Table<Meta, string>

  constructor() {
    super('planner')
    this.version(1).stores({
      tasks: 'id, due, state, goalId, updatedAt',
      habits: 'id, active, updatedAt',
      habitLogs: 'id, habitId, date, [habitId+date], updatedAt',
      goals: 'id, type, parentId, updatedAt',
      reviews: 'id, type, periodStart, updatedAt',
      outbox: '++seq, table, recordId',
      meta: 'key',
    })
    // v2: adds Project entity + task->project link (Board feature). Existing
    // stores not restated here carry forward unchanged; no .upgrade() needed
    // since `projects` starts empty and `Task.projectId` is optional.
    this.version(2).stores({
      tasks: 'id, due, state, projectId, goalId, updatedAt',
      projects: 'id, archived, updatedAt',
    })
  }
}

export const db = new PlannerDB()

export const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`

const EMOJI_RE = /\p{Extended_Pictographic}/u
const EMOJI_GUESS: [RegExp, string][] = [
  [/water|drink|hydrat/i, '💧'],
  [/read|book/i, '📖'],
  [/exerc|gym|run|workout|walk/i, '🏃'],
  [/sleep|bed|rest/i, '😴'],
  [/medit|calm|breath/i, '🧘'],
  [/eat|meal|food|diet/i, '🥗'],
  [/journal|write|note/i, '✍️'],
  [/vitamin|pill|med/i, '💊'],
  [/stretch|yoga/i, '🤸'],
]
/** A habit's stored emoji may be corrupted (old ServiceNow round-trip bug).
    Show a real emoji regardless: the stored one if valid, else a guess from
    the name, else a neutral marker. */
export function cleanEmoji(emoji?: string, name = ''): string {
  if (emoji && EMOJI_RE.test(emoji)) return emoji
  for (const [re, e] of EMOJI_GUESS) if (re.test(name)) return e
  return '✅'
}

/** Local-date YYYY-MM-DD. (toISOString would shift the date for TZs ahead
    of UTC between midnight and ~08:00 — tasks would log to yesterday.) */
export const todayStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Fired after any local write or applied sync pull; screens reload on it. */
export const CHANGED = 'planner:changed'
export const notifyChange = () => window.dispatchEvent(new CustomEvent(CHANGED))

/** Write a record and queue it for sync in one transaction. */
export async function writeAndQueue<T extends { id: string; updatedAt: number }>(
  table: Table<T, string>,
  tableName: OutboxEntry['table'],
  record: T,
) {
  await db.transaction('rw', table, db.outbox, async () => {
    await table.put(record)
    await db.outbox.add({ table: tableName, recordId: record.id, editedAt: record.updatedAt })
  })
  notifyChange()
}

/** Local mirror of the ServiceNow roll-up Business Rule (doc §06): a goal's
    progress comes from its tasks; each ancestor is the average of its
    children. Runs offline so bars move immediately; the server recomputes
    authoritatively after sync, so these writes skip the outbox. */
export async function rollUpGoal(goalId: string) {
  const leaf = await db.goals.get(goalId)
  if (!leaf) return

  const setProgress = async (g: Goal, pct: number) => {
    const status =
      pct >= 100 ? 'completed' : pct > 0 && g.status === 'not_started' ? 'in_progress' : g.status
    await db.goals.put({ ...g, progress: pct, status, updatedAt: Date.now() })
  }

  const tasks = await db.tasks
    .where('goalId')
    .equals(goalId)
    .and((t) => !t.deleted && t.state !== 'cancelled')
    .toArray()
  if (tasks.length > 0) {
    const pct = Math.round((tasks.filter((t) => t.state === 'done').length / tasks.length) * 100)
    await setProgress(leaf, pct)
  }

  let parentId = leaf.parentId
  let depth = 0
  while (parentId && depth++ < 10) {
    const parent = await db.goals.get(parentId)
    if (!parent) break
    const children = await db.goals
      .where('parentId')
      .equals(parentId)
      .and((c) => !c.deleted)
      .toArray()
    if (children.length === 0) break
    const avg = Math.round(children.reduce((s, c) => s + c.progress, 0) / children.length)
    await setProgress(parent, avg)
    parentId = parent.parentId
  }
  notifyChange()
}

/** Streaks derived from logs, never stored as a trusted counter (doc §06). */
export async function habitStreak(habitId: string): Promise<number> {
  const logs = await db.habitLogs.where('habitId').equals(habitId).toArray()
  const done = new Set(logs.filter((l) => !l.deleted && l.count > 0).map((l) => l.date))
  let streak = 0
  const cursor = new Date()
  // Today counts if logged; otherwise the streak is measured up to yesterday.
  if (!done.has(todayStr(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (done.has(todayStr(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}
