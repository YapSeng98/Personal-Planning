import { db, todayStr, habitStreak } from '../db/db'

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

  return {
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
