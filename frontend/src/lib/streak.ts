// Today's day streak: days you got your day's work done, counted from the
// tasks themselves (never stored, like a habit's streak). A day counts when
// its ⭐ top task is done — or, on a day without one, any task. Days off are
// allowed: a weekend with nothing planned, or a missed day, doesn't break it;
// three days in a row without a counted day do. Only counted days add to the
// number, so it stays honest.
import { db, addDays, type Task } from '../db/db'

/** hit = the day counts; miss = planned but not done; off = nothing planned */
export type DayMark = 'hit' | 'miss' | 'off'

/** How far back the streak (and the best one) is looked for. */
const WINDOW = 400
/** Days in a row without a counted day that end a streak. */
const BREAK = 3

export function dayMark(tasks: Task[]): DayMark {
  const list = tasks.filter((x) => !x.deleted && x.state !== 'cancelled')
  if (!list.length) return 'off'
  const tops = list.filter((x) => x.isMit)
  return (tops.length ? tops : list).some((x) => x.state === 'done') ? 'hit' : 'miss'
}

/** Every day before `today` in the window, marked. */
export async function pastMarks(today: string): Promise<Map<string, DayMark>> {
  const rows = await db.tasks.where('due').between(addDays(today, -WINDOW), today, true, false).toArray()
  const byDay = new Map<string, Task[]>()
  for (const x of rows) {
    const list = byDay.get(x.due!)
    if (list) list.push(x)
    else byDay.set(x.due!, [x])
  }
  return new Map([...byDay].map(([d, list]) => [d, dayMark(list)]))
}

export interface Streak {
  /** counted days in the streak running now */
  current: number
  best: number
  /** today is the last chance: two days without a counted one already */
  atRisk: boolean
  /** today already counts */
  today: boolean
}

export function streakOf(past: Map<string, DayMark>, today: string, todayMark: DayMark): Streak {
  // the run now: today if it counts already (not yet isn't a miss), then back
  let current = todayMark === 'hit' ? 1 : 0
  let gap = 0
  let lead = -1 // days without a counted one right before today
  for (let i = 1; i <= WINDOW; i++) {
    if (past.get(addDays(today, -i)) === 'hit') {
      if (lead < 0) lead = i - 1
      current++
      gap = 0
    } else if (++gap >= BREAK) break
  }
  if (lead < 0) lead = BREAK
  // the best run in the window, oldest first, by the same rule
  let best = current, run = 0
  gap = 0
  for (let i = WINDOW; i >= 1; i--) {
    if (past.get(addDays(today, -i)) === 'hit') { run++; gap = 0 }
    else if (++gap >= BREAK) run = 0
    best = Math.max(best, run)
  }
  return { current, best, atRisk: current > 0 && todayMark !== 'hit' && lead === BREAK - 1, today: todayMark === 'hit' }
}
