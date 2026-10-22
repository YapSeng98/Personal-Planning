import { db, todayStr, habitStreak, type ProjectColor } from '../db/db'
import { minutesByDay, spentHours } from './items'

export interface DayStat {
  date: string
  label: string
  done: number
  total: number
}
export interface HabitStat {
  id: string
  name: string
  emoji: string
  pct: number // 0..100 over the window
  days: number // days logged in window
  streak: number
}
export interface FocusDay {
  date: string
  label: string
  minutes: number
}
export interface FocusProject {
  /** '' = tasks without a project */
  id: string
  title: string
  color?: ProjectColor
  minutes: number
}
export interface EstimateStats {
  /** finished tasks with an estimate and timed work, last 30 days */
  n: number
  /** time spent ÷ time estimated, over all of them */
  ratio: number
  /** within ±25% of the estimate */
  onTarget: number
  /** the biggest overruns */
  over: { id: string; title: string; est: number; spent: number }[]
}
export interface FocusStats {
  daily: FocusDay[] // last 14 days
  todayMin: number
  weekMin: number // Mon–Sun
  /** average over the days with any focus time in the last 14 */
  avgMin: number
  byProject: FocusProject[] // last 30 days
  estimates: EstimateStats
}

export interface Analytics {
  weekPct: number
  weekDone: number
  weekTotal: number
  bestStreak: number
  activeGoals: number
  reviewsLogged: number
  avgProgress: number
  daily: DayStat[] // last 14 days
  habits: HabitStat[]
  moods: { date: string; mood: string; energy: number }[] // recent reviews
  focus: FocusStats
}

const MOOD_EMOJI: Record<string, string> = { great: '😊', good: '🙂', okay: '😐', bad: '☹️' }

export async function computeAnalytics(days = 14, habitWindow = 30): Promise<Analytics> {
  const tasks = await db.tasks.filter((t) => !t.deleted).toArray()
  const byDay = new Map<string, { done: number; total: number }>()
  for (const t of tasks) {
    if (!t.due || t.state === 'cancelled') continue
    const e = byDay.get(t.due) ?? { done: 0, total: 0 }
    e.total++
    if (t.state === 'done') e.done++
    byDay.set(t.due, e)
  }

  const daily: DayStat[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000)
    const date = todayStr(d)
    const e = byDay.get(date) ?? { done: 0, total: 0 }
    daily.push({ date, label: 'SMTWTFS'[d.getDay()], done: e.done, total: e.total })
  }

  // This week Mon–Sun
  const now = new Date()
  const mon = new Date(now)
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  let weekDone = 0
  let weekTotal = 0
  for (let i = 0; i < 7; i++) {
    const e = byDay.get(todayStr(new Date(mon.getTime() + i * 86400_000)))
    if (e) {
      weekDone += e.done
      weekTotal += e.total
    }
  }

  // Habits over the window
  const habitDefs = await db.habits.filter((h) => h.active === 1 && !h.deleted).toArray()
  const winStart = todayStr(new Date(Date.now() - (habitWindow - 1) * 86400_000))
  const logs = await db.habitLogs.filter((l) => !l.deleted && l.count > 0 && l.date >= winStart).toArray()
  const habits: HabitStat[] = []
  let bestStreak = 0
  for (const h of habitDefs) {
    const loggedDays = new Set(logs.filter((l) => l.habitId === h.id).map((l) => l.date)).size
    const streak = await habitStreak(h.id)
    bestStreak = Math.max(bestStreak, streak)
    habits.push({
      id: h.id,
      name: h.name,
      emoji: h.emoji,
      pct: Math.round((loggedDays / habitWindow) * 100),
      days: loggedDays,
      streak,
    })
  }
  habits.sort((a, b) => b.pct - a.pct)

  // Goals + reviews
  const goals = await db.goals.filter((g) => !g.deleted).toArray()
  const activeGoals = goals.filter((g) => g.status === 'in_progress' || g.status === 'at_risk').length
  const withProgress = goals.filter((g) => g.type !== 'vision')
  const avgProgress = withProgress.length
    ? Math.round(withProgress.reduce((s, g) => s + g.progress, 0) / withProgress.length)
    : 0

  const reviews = await db.reviews.filter((r) => !r.deleted).toArray()
  reviews.sort((a, b) => b.periodStart.localeCompare(a.periodStart))
  const moods = reviews
    .filter((r) => r.mood || r.energy)
    .slice(0, 10)
    .reverse()
    .map((r) => ({ date: r.periodStart, mood: r.mood ? MOOD_EMOJI[r.mood] : '·', energy: r.energy ?? 0 }))

  // Focus time (the timer): per day, per project, and estimates vs actual
  const dayMin = new Map<string, number>()
  const projMin = new Map<string, number>()
  const monthStart = todayStr(new Date(Date.now() - 29 * 86400_000))
  for (const t of tasks) {
    if (!t.actualHours && !t.focusLog?.length) continue
    for (const [d, m] of minutesByDay(t)) {
      dayMin.set(d, (dayMin.get(d) ?? 0) + m)
      if (d >= monthStart) projMin.set(t.projectId ?? '', (projMin.get(t.projectId ?? '') ?? 0) + m)
    }
  }
  const focusDaily: FocusDay[] = daily.map((x) => ({ date: x.date, label: x.label, minutes: Math.round(dayMin.get(x.date) ?? 0) }))
  let weekMin = 0
  for (let i = 0; i < 7; i++) weekMin += dayMin.get(todayStr(new Date(mon.getTime() + i * 86400_000))) ?? 0
  const active = focusDaily.filter((x) => x.minutes > 0)
  const projects = new Map((await db.projects.toArray()).map((p) => [p.id, p]))
  const byProject: FocusProject[] = [...projMin]
    .filter(([, m]) => m >= 1)
    .map(([id, minutes]) => ({ id, title: projects.get(id)?.title ?? '', color: projects.get(id)?.color, minutes: Math.round(minutes) }))
    .sort((a, b) => b.minutes - a.minutes)
  const finished = tasks.filter((t) => t.state === 'done' && (t.estimatedHours ?? 0) > 0 && spentHours(t) > 0
    && (t.completedAt ? todayStr(new Date(t.completedAt)) : t.due ?? '') >= monthStart)
  const est = finished.reduce((n, t) => n + t.estimatedHours!, 0)
  const spent = finished.reduce((n, t) => n + spentHours(t), 0)
  const estimates: EstimateStats = {
    n: finished.length,
    ratio: est ? spent / est : 0,
    onTarget: finished.filter((t) => Math.abs(spentHours(t) / t.estimatedHours! - 1) <= 0.25).length,
    over: finished
      .filter((t) => spentHours(t) > t.estimatedHours! * 1.25)
      .sort((a, b) => (spentHours(b) - b.estimatedHours!) - (spentHours(a) - a.estimatedHours!))
      .slice(0, 3)
      .map((t) => ({ id: t.id, title: t.title, est: t.estimatedHours!, spent: spentHours(t) })),
  }
  const focus: FocusStats = {
    daily: focusDaily,
    todayMin: Math.round(dayMin.get(todayStr()) ?? 0),
    weekMin: Math.round(weekMin),
    avgMin: active.length ? Math.round(active.reduce((n, x) => n + x.minutes, 0) / active.length) : 0,
    byProject,
    estimates,
  }

  return {
    focus,
    weekPct: weekTotal ? Math.round((weekDone / weekTotal) * 100) : 0,
    weekDone,
    weekTotal,
    bestStreak,
    activeGoals,
    reviewsLogged: reviews.length,
    avgProgress,
    daily,
    habits,
    moods,
  }
}
