import Dexie, { type Table } from 'dexie'

// Local mirror of the x_pps_* ServiceNow tables (design doc §04/§09).
// `id` is the client_uuid used for idempotent sync; `sysId` arrives after
// the record first reaches ServiceNow. `deleted` is the soft-delete tombstone.

export type TaskState = 'open' | 'done' | 'cancelled'

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
  isMit?: boolean
  deleted: 0 | 1
  updatedAt: number
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
  table: 'task' | 'habit' | 'habit_log' | 'goal' | 'review'
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
  }
}

export const db = new PlannerDB()

export const uuid = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`

export const todayStr = (d = new Date()) => d.toISOString().slice(0, 10)

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
