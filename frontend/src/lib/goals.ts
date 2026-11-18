// Goal helpers for the screens that motivate: what a goal is for, and which
// goals a finished task just moved.
import { db, rollUpGoal, type Goal, type GoalType } from '../db/db'

export interface GoalMove { id: string; title: string; type: GoalType; from: number; to: number }

/** The goal and its ancestors, nearest first. */
function chainOf(id: string | undefined, byId: (id: string) => Goal | undefined): Goal[] {
  const out: Goal[] = []
  for (let depth = 0; id && depth < 11; depth++) {
    const g = byId(id)
    if (!g || g.deleted) break
    out.push(g)
    id = g.parentId
  }
  return out
}

/** Why a task's goal matters: its own "why it matters", else the nearest
    ancestor's (a week goal under a year goal shares the year's reason). */
export function whyFor(goalId: string | undefined, goals: Map<string, Goal>): { text: string; goal: Goal } | null {
  const g = chainOf(goalId, (id) => goals.get(id)).find((x) => x.whyItMatters?.trim())
  return g ? { text: g.whyItMatters!.trim(), goal: g } : null
}

/** The goals today's ticks moved, each from where it was before the first
    (for the day's card; kept for the day on this device). */
const MOVED_KEY = 'planner_moved'
export function movedOn(day: string): GoalMove[] {
  try {
    const v = JSON.parse(localStorage.getItem(MOVED_KEY) ?? 'null') as { day: string; list: GoalMove[] } | null
    return v?.day === day ? v.list : []
  } catch { return [] }
}
export function noteMoves(day: string, moves: GoalMove[]) {
  const list = movedOn(day)
  for (const m of moves) {
    const seen = list.find((x) => x.id === m.id)
    if (seen) { seen.to = m.to; seen.title = m.title }
    else list.push({ ...m })
  }
  try { localStorage.setItem(MOVED_KEY, JSON.stringify({ day, list })) } catch { /* private mode: the card just won't list them */ }
}

/** rollUpGoal, reporting the goals whose progress it changed — the task's
    own goal first, then each ancestor that moved with it. */
export async function rollUpReporting(goalId: string): Promise<GoalMove[]> {
  // the chain as it is now, one level at a time (a parent is known from its child)
  const before = new Map<string, Goal>()
  let id: string | undefined = goalId
  for (let depth = 0; id && depth < 11; depth++) {
    const g: Goal | undefined = await db.goals.get(id)
    if (!g) break
    before.set(g.id, g)
    id = g.parentId
  }
  const chain = chainOf(goalId, (x) => before.get(x))
  await rollUpGoal(goalId)
  const after = await db.goals.bulkGet(chain.map((g) => g.id))
  return chain.flatMap((g, i) => {
    const now = after[i]
    return now && !now.deleted && now.progress !== g.progress
      ? [{ id: g.id, title: now.title, type: now.type, from: g.progress, to: now.progress }] : []
  })
}
