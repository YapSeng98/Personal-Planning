// Is a goal on pace? Where its progress would be today if it moved evenly from
// the start of its period (a year, quarter, month or week before its target
// date) to 100% on the target date. Goals have no start date of their own, so
// the level gives the period.
import { addDays, todayStr, type Goal } from '../db/db'
import type { TFn } from './i18n'

export interface Pace {
  /** where an even pace would be today, 0–100 */
  expected: number
  /** whole days to the target date (negative: past it) */
  daysLeft: number
  /** ahead / on = within 5 points of the even pace; behind = by `gap` */
  state: 'ahead' | 'on' | 'behind' | 'late'
  /** points behind the even pace */
  gap: number
}

const MONTHS: Partial<Record<Goal['type'], number>> = { year: 12, quarter: 3, month: 1 }
const DAY = 86_400_000

function periodStart(g: Goal): string {
  if (g.type === 'week') return addDays(g.targetDate!, -7)
  const d = new Date(g.targetDate! + 'T00:00')
  d.setMonth(d.getMonth() - (MONTHS[g.type] ?? 12))
  return todayStr(d)
}

/** null for goals without a target date, visions and finished ones. */
export function paceOf(g: Goal, today: string): Pace | null {
  if (!g.targetDate || g.type === 'vision' || g.status === 'completed' || g.status === 'abandoned') return null
  const at = (ymd: string) => new Date(ymd + 'T00:00').getTime()
  const start = at(periodStart(g)), end = at(g.targetDate), now = at(today)
  const daysLeft = Math.round((end - now) / DAY)
  if (daysLeft < 0) return g.progress >= 100 ? null : { expected: 100, daysLeft, state: 'late', gap: 100 - g.progress }
  const expected = Math.round(Math.max(0, Math.min(1, (now - start) / (end - start))) * 100)
  const gap = expected - g.progress
  return { expected, daysLeft, gap: Math.max(0, gap), state: gap > 5 ? 'behind' : gap < -5 ? 'ahead' : 'on' }
}

/** In words: "On track · 43 days left", "Behind by 12% · 9 days left". */
export function paceLine(p: Pace, t: TFn): string {
  if (p.state === 'late') return t(p.daysLeft === -1 ? 'pace.late1' : 'pace.late', { n: -p.daysLeft })
  const left = p.daysLeft === 0 ? t('pace.dueToday') : t(p.daysLeft === 1 ? 'pace.dayLeft' : 'pace.daysLeft', { n: p.daysLeft })
  if (p.state === 'behind') return `${t('pace.behind', { n: p.gap })} · ${left}`
  return `${t(p.state === 'ahead' ? 'pace.ahead' : 'pace.on')} · ${left}`
}
