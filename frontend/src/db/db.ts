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
  /** In-app reminder: surface this task on Today this many days before it's
      due (0 = the due day itself). Undefined = no reminder. */
  reminderDaysBefore?: number
  /** If set, this task repeats: once its due date's next scheduled
      occurrence has arrived, a NEW row is generated (see rollRecurringTasks)
      rather than this row being mutated — this row stays as history. */
  recurrence?: 'daily' | 'weekly' | 'monthly'
  /** Links every occurrence of a recurring task together. Set to the first
      occurrence's own id when recurrence is first turned on. */
  seriesId?: string
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

/** A sketch note is either hand-drawn or typed. Local-only — never synced
    (the push/pull pipeline sends whole-record payloads with no chunking,
    and ServiceNow string fields cap out around 4000 chars; a canvas PNG
    dataUrl runs far larger, and typed notes could too). */
export interface DrawingNote {
  id: string
  title: string
  /** Missing on records saved before typed notes existed — treat as 'draw'. */
  kind?: 'draw' | 'text'
  /** kind='draw' */
  dataUrl?: string
  /** kind='text' */
  text?: string
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
  drawings!: Table<DrawingNote, string>
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
    // v3: adds DrawingNote (Sketches feature). Local-only — deliberately not
    // in the outbox table set, so it never enters the sync pipeline.
    this.version(3).stores({
      drawings: 'id, updatedAt',
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

function nextOccurrence(date: string, recurrence: NonNullable<Task['recurrence']>): string {
  const d = new Date(date + 'T00:00')
  if (recurrence === 'daily') d.setDate(d.getDate() + 1)
  else if (recurrence === 'weekly') d.setDate(d.getDate() + 7)
  else d.setMonth(d.getMonth() + 1)
  return todayStr(d)
}

/** The latest (most recent due date) row in each still-recurring series —
    "still recurring" meaning that latest row has `recurrence` set. Shared by
    rollRecurringTasks (decides whether to generate the next real row) and
    the Plan screens (decide which future days to preview a repeat on). */
export async function activeRecurringSeries(): Promise<Task[]> {
  const all = await db.tasks.filter((t) => !t.deleted && !!t.seriesId).toArray()
  const bySeries = new Map<string, Task[]>()
  for (const t of all) {
    const arr = bySeries.get(t.seriesId!) ?? []
    arr.push(t)
    bySeries.set(t.seriesId!, arr)
  }
  const latest: Task[] = []
  for (const rows of bySeries.values()) {
    const l = rows.reduce((a, b) => ((a.due ?? '') > (b.due ?? '') ? a : b))
    if (l.recurrence && l.due) latest.push(l)
  }
  return latest
}

/** True if `candidateDate` is a day this series would land on, projecting
    forward from its latest real occurrence — used to preview a recurring
    task on days that don't have a materialized row yet (e.g. the rest of
    this week for a daily task). Never true for the latest row's own date or
    anything before it, since that's real data, not a preview. */
export function isProjectedOccurrence(latest: Task, candidateDate: string): boolean {
  if (!latest.due || !latest.recurrence || candidateDate <= latest.due) return false
  if (latest.recurrence === 'daily') return true
  const latestD = new Date(latest.due + 'T00:00')
  const candD = new Date(candidateDate + 'T00:00')
  if (latest.recurrence === 'weekly') {
    const diffDays = Math.round((candD.getTime() - latestD.getTime()) / 86400_000)
    return diffDays % 7 === 0
  }
  return latestD.getDate() === candD.getDate() // monthly: same day-of-month
}

/** Collapses accidental duplicate tasks — same title, same due date — down
    to one. Deliberately NOT scoped to recurring tasks (no `seriesId`
    requirement): a plain task created twice by a mis-click on any "+ add
    task" button looks identical to a recurring-series duplicate from the
    user's side, and if this only matched rows that already have a
    `seriesId`, a plain duplicate would never be caught at all — it has no
    seriesId to match on, so it would sit there forever. Runs every time
    rollRecurringTasks does (cheap at personal-app scale), repairing damage
    from before overlapping-call/multi-click guards existed. Keeps whichever
    row is done, else the oldest — tombstones the rest. */
async function dedupeRecurringOccurrences(): Promise<number> {
  const all = await db.tasks.filter((t) => !t.deleted && !!t.due).toArray()
  const byKey = new Map<string, Task[]>()
  for (const t of all) {
    const key = `${t.title}|${t.due}`
    const arr = byKey.get(key) ?? []
    arr.push(t)
    byKey.set(key, arr)
  }
  let removed = 0
  for (const rows of byKey.values()) {
    if (rows.length <= 1) continue
    rows.sort((a, b) => (a.state === 'done' ? -1 : 1) - (b.state === 'done' ? -1 : 1) || a.updatedAt - b.updatedAt)
    for (const dupe of rows.slice(1)) {
      const tombstone: Task = { ...dupe, deleted: 1, updatedAt: Date.now() }
      await writeAndQueue(db.tasks, 'task', tombstone)
      removed++
    }
  }
  return removed
}

/** Recurring tasks are one row per occurrence, linked by seriesId — the
    latest occurrence in each series never mutates; when its next scheduled
    date has arrived, a fresh row is generated for it (whether or not the
    previous one was ever completed) and the old row stays as history. For
    weekly/monthly series the new row lands on the actual scheduled date,
    which may already be overdue if the app wasn't opened for a while — it
    does not jump forward to today. Cheap no-op when nothing is due yet —
    see startRecurringLoop for when this actually gets called.

    Guarded against overlapping invocations: two calls firing close together
    (StrictMode's dev double-effect, rapid visibilitychange during tab
    switching, the 30-min interval landing next to a visibility trigger)
    could otherwise both read "no occurrence for today yet" before either
    had written one, and both create it — the exact bug dedupeRecurringOccurrences
    exists to clean up. A second call while one is already running just waits
    for it instead of racing it. */
let rollInFlight: Promise<number> | null = null
function rollRecurringTasksLocked(): Promise<number> {
  if (rollInFlight) return rollInFlight
  rollInFlight = (async () => {
    const removed = await dedupeRecurringOccurrences()
    await rollRecurringTasksInner()
    return removed
  })().finally(() => {
    rollInFlight = null
  })
  return rollInFlight
}

export async function rollRecurringTasks(): Promise<void> {
  await rollRecurringTasksLocked()
}

/** Manual, user-triggered version of the same cleanup+catch-up the app runs
    automatically in the background (Settings → "Clean up duplicate tasks")
    — reports how many duplicate occurrences it found and removed, so
    there's a direct, on-screen way to confirm the fix ran even if a
    background trigger hasn't fired yet (e.g. a stale cached PWA that hasn't
    picked up a newer app version). Shares the same lock as the automatic
    path, so it can't race it. */
export async function cleanupDuplicateRecurringTasks(): Promise<number> {
  return rollRecurringTasksLocked()
}

async function rollRecurringTasksInner() {
  const today = todayStr()
  const series = await activeRecurringSeries()

  for (const latest of series) {
    // Walk forward to the latest scheduled date that isn't past today —
    // may land on a past-but-unreached date for weekly/monthly cadences.
    let due = latest.due!
    for (;;) {
      const candidate = nextOccurrence(due, latest.recurrence!)
      if (candidate > today) break
      due = candidate
    }
    if (due === latest.due) continue // next occurrence isn't due yet

    const startTime = latest.timeBlockStart?.slice(11, 16)
    const endTime = latest.timeBlockEnd?.slice(11, 16)
    const next: Task = {
      ...latest,
      id: uuid(),
      sysId: undefined,
      due,
      timeBlockStart: startTime ? `${due}T${startTime}` : undefined,
      timeBlockEnd: endTime ? `${due}T${endTime}` : undefined,
      actualHours: undefined,
      state: 'open',
      sortOrder: undefined,
      updatedAt: Date.now(),
    }
    await writeAndQueue(db.tasks, 'task', next)
  }
}

/** rollRecurringTasks only matters at a day boundary, but React only mounts
    once — a PWA left open (or just backgrounded) across midnight, which is
    the common case on mobile, would never see it run again and a "daily"
    task would sit as a preview forever. Re-checks whenever the tab/app
    becomes visible again, plus a periodic safety net for tabs that are
    never backgrounded at all.

    Idempotent: App.tsx's mount effect has no cleanup, so React StrictMode's
    dev-only double-invoke would otherwise attach this twice (two listeners,
    two intervals, both running forever) — harmless now that
    rollRecurringTasks itself is lock-protected, but wasteful. */
let recurringLoopStarted = false
export function startRecurringLoop() {
  if (recurringLoopStarted) return
  recurringLoopStarted = true
  rollRecurringTasks()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') rollRecurringTasks()
  })
  setInterval(rollRecurringTasks, 30 * 60_000)
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
  const habit = await db.habits.get(habitId)
  const target = habit?.targetPerDay ?? 1
  const logs = await db.habitLogs.where('habitId').equals(habitId).toArray()
  const byDate = new Map<string, number>()
  for (const l of logs) { if (!l.deleted) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.count) }
  // A day only counts toward the streak once its full daily target is met —
  // matters for multi-tick habits (e.g. water, target 8/day), where partial
  // logging is common but shouldn't read as a completed day.
  const done = new Set([...byDate.entries()].filter(([, c]) => c >= target).map(([d]) => d))
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

/** One day's cell in a habit's calendar view. */
export interface HabitDay {
  date: string
  count: number
  hit: boolean // count >= targetPerDay
  /** This week's dates after today — grid stays calendar-aligned but these haven't happened yet. */
  future: boolean
  isToday: boolean
}

export interface HabitStats {
  current: number
  /** Best streak ever recorded, not just the one still running. */
  longest: number
  /** Total distinct days this habit has ever been logged (count > 0). */
  totalDays: number
  /** % of the last 30 calendar days that hit target. */
  last30Rate: number
  /** Completions per weekday, index 0=Sun..6=Sat — reveals which day breaks the chain. */
  weekday: number[]
  /** Daily cells for the last `weeks` weeks, oldest first — for a calendar/heatmap. */
  heatmap: HabitDay[]
  firstLogDate: string | null
}

/** Full accumulated history for one habit: current + longest streak (walking
    the whole sorted date set, not just backwards from today), a weekday
    pattern, and calendar cells — the numbers a single "current streak" can't
    show. Read-heavy (habit detail page only), not called on Today's hot path. */
export async function habitStats(habitId: string, weeks = 16): Promise<HabitStats> {
  const habit = await db.habits.get(habitId)
  const target = habit?.targetPerDay ?? 1
  const logs = await db.habitLogs.where('habitId').equals(habitId).and((l) => !l.deleted).toArray()
  const byDate = new Map<string, number>()
  for (const l of logs) byDate.set(l.date, (byDate.get(l.date) ?? 0) + l.count)
  const hitDates = [...byDate.entries()].filter(([, c]) => c >= target).map(([d]) => d).sort()
  // Any day with real activity, not just days that reached the full target —
  // a multi-tick habit (e.g. water, target 8/day) is logged far more often
  // than it's fully hit, and "total days" should count all of that activity.
  const loggedDates = [...byDate.entries()].filter(([, c]) => c > 0).map(([d]) => d).sort()

  const current = await habitStreak(habitId)

  // Longest-ever: walk the sorted hit dates once, counting consecutive-day runs.
  let longest = 0
  let run = 0
  let prev: Date | null = null
  for (const d of hitDates) {
    const cur = new Date(d + 'T00:00')
    if (prev) {
      const gapDays = Math.round((cur.getTime() - prev.getTime()) / 86400_000)
      run = gapDays === 1 ? run + 1 : 1
    } else {
      run = 1
    }
    longest = Math.max(longest, run)
    prev = cur
  }
  longest = Math.max(longest, current)

  const totalDays = loggedDates.length

  // Logged activity, not strictly-hit days — same reasoning as totalDays
  // above. A weekday pattern built only from fully-hit days is empty (and
  // looks broken) for any habit that's rarely or never fully maxed out.
  const weekday = [0, 0, 0, 0, 0, 0, 0]
  for (const d of loggedDates) weekday[new Date(d + 'T00:00').getDay()]++

  let last30Hit = 0
  for (let i = 0; i < 30; i++) {
    const date = todayStr(new Date(Date.now() - i * 86400_000))
    if ((byDate.get(date) ?? 0) >= target) last30Hit++
  }
  const last30Rate = Math.round((last30Hit / 30) * 100)

  // Calendar-aligned grid: always starts on a Sunday and ends on a Saturday,
  // so row 0 is always Sunday regardless of what weekday "today" falls on
  // (otherwise the weekday labels would silently drift day to day). Cells
  // after today (this week's remaining days) are marked `future`, not `miss`.
  const now = new Date()
  const todayKey = todayStr(now)
  const endOfWeek = new Date(now)
  endOfWeek.setDate(now.getDate() + (6 - now.getDay()))
  const totalCells = weeks * 7
  const start = new Date(endOfWeek)
  start.setDate(endOfWeek.getDate() - totalCells + 1)

  const heatmap: HabitDay[] = []
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const date = todayStr(d)
    const future = d.getTime() > now.getTime() && date !== todayKey
    const count = future ? 0 : (byDate.get(date) ?? 0)
    heatmap.push({ date, count, hit: !future && count >= target, future, isToday: date === todayKey })
  }

  return { current, longest, totalDays, last30Rate, weekday, heatmap, firstLogDate: loggedDates[0] ?? null }
}
