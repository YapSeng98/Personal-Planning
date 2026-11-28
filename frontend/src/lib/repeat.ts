/** How a repeating task repeats — stored in Task.recurrence as text, so a new
    kind of repeat needs no new column:
    - 'daily' | 'weekly' | 'monthly': the first three, still written for those
      (older app versions and the server's reminders know them); weekly and
      monthly follow the task's own date.
    - anything else is a small piece of an iCalendar RRULE:
      FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL=n (every n days / weeks / …),
      BYDAY=MO,WE,FR (weekly) or 2TU / -1FR (monthly: the 2nd Tuesday, the
      last Friday), BYMONTHDAY=28 | -1 (the last day), BYMONTH=11 (yearly).
      Weeks start on Monday.
    Mirrored by repeat_next / repeat_on in supabase/schema.sql (the push
    reminders of days not made yet) — keep the two in step;
    `npm run test:sql` checks they agree.
    Self-contained (no imports) so the SQL test can load it in Node. */

export type Freq = 'day' | 'week' | 'month' | 'year'
export interface Rule {
  freq: Freq
  /** every n days / weeks / months / years (≥ 1) */
  every: number
  /** week: 0 = Sunday … 6 = Saturday */
  days?: number[]
  /** month / year: 1–31, or -1 = the last day (month only) */
  monthDay?: number
  /** month: the nth (1–4, or -1 = last) `weekday` of the month */
  nth?: number
  weekday?: number
  /** year: 1–12 */
  month?: number
}

const CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const FREQS: Record<string, Freq> = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }
const LEGACY = new Set(['daily', 'weekly', 'monthly'])
export const WEEKDAYS_RULE = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'

const D = (s: string) => new Date(s + 'T00:00')
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const plus = (s: string, n: number) => { const d = D(s); d.setDate(d.getDate() + n); return ymd(d) }
const dim = (y: number, m0: number) => new Date(y, m0 + 1, 0).getDate()
/** Monday = 0 … Sunday = 6 */
const mon0 = (w: number) => (w + 6) % 7
const int = (v: string | undefined) => (v && /^-?\d{1,3}$/.test(v) ? Number(v) : undefined)

export const isLegacy = (s: string | undefined) => !!s && LEGACY.has(s)

/** The rule a stored value stands for. `anchor` (the task's date) fills in
    what 'weekly' / 'monthly' leave to it. null: not a repeat this version
    understands — treated as not repeating, never guessed at. */
export function parseRule(s: string | undefined, anchor: string): Rule | null {
  if (!s) return null
  const a = D(anchor)
  if (s === 'daily') return { freq: 'day', every: 1 }
  if (s === 'weekly') return { freq: 'week', every: 1, days: [a.getDay()] }
  if (s === 'monthly') return { freq: 'month', every: 1, monthDay: a.getDate() }
  const kv = new Map(s.split(';').map((p) => p.split('=') as [string, string]))
  const f = kv.get('FREQ') ?? ''
  const freq = Object.hasOwn(FREQS, f) ? FREQS[f] : undefined
  if (!freq) return null
  const every = Math.min(99, Math.max(1, int(kv.get('INTERVAL')) ?? 1))
  const byday = kv.get('BYDAY')
  if (freq === 'day') return { freq, every }
  if (freq === 'week') {
    const days = (byday ?? '').split(',').map((c) => CODES.indexOf(c)).filter((i) => i >= 0)
    return { freq, every, days: days.length ? [...new Set(days)] : [a.getDay()] }
  }
  if (freq === 'month') {
    const m = byday?.match(/^(-1|[1-4])(SU|MO|TU|WE|TH|FR|SA)$/)
    if (m) return { freq, every, nth: Number(m[1]), weekday: CODES.indexOf(m[2]) }
    const md = int(kv.get('BYMONTHDAY'))
    return { freq, every, monthDay: md != null && (md === -1 || (md >= 1 && md <= 31)) ? md : a.getDate() }
  }
  const month = int(kv.get('BYMONTH'))
  const md = int(kv.get('BYMONTHDAY'))
  return {
    freq, every,
    month: month != null && month >= 1 && month <= 12 ? month : a.getMonth() + 1,
    monthDay: md != null && md >= 1 && md <= 31 ? md : a.getDate(),
  }
}

/** What to store for a rule that starts on `anchor` — the first three
    kinds as their old names whenever the rule is one of them. */
export function ruleString(r: Rule, anchor: string): string {
  const a = D(anchor)
  const days = r.freq === 'week' ? [...new Set(r.days?.length ? r.days : [a.getDay()])].sort((x, y) => mon0(x) - mon0(y)) : []
  if (r.every === 1) {
    if (r.freq === 'day' || (r.freq === 'week' && days.length === 7)) return 'daily'
    if (r.freq === 'week' && days.length === 1 && days[0] === a.getDay()) return 'weekly'
    // 'monthly' drifts after a short month (the 31st → the 30th → …), so
    // only days every month has
    if (r.freq === 'month' && r.nth == null && r.monthDay === a.getDate() && a.getDate() <= 28) return 'monthly'
  }
  const p = [`FREQ=${Object.keys(FREQS).find((k) => FREQS[k] === r.freq)}`]
  if (r.every > 1) p.push(`INTERVAL=${r.every}`)
  if (r.freq === 'week') p.push(`BYDAY=${days.map((d) => CODES[d]).join(',')}`)
  if (r.freq === 'month') {
    if (r.nth != null && r.weekday != null) p.push(`BYDAY=${r.nth}${CODES[r.weekday]}`)
    else p.push(`BYMONTHDAY=${r.monthDay ?? a.getDate()}`)
  }
  if (r.freq === 'year') p.push(`BYMONTH=${r.month ?? a.getMonth() + 1}`, `BYMONTHDAY=${r.monthDay ?? a.getDate()}`)
  return p.join(';')
}

function inMonth(r: Rule, y: number, m0: number): string {
  const n = dim(y, m0)
  let day: number
  if (r.nth != null && r.weekday != null) {
    if (r.nth > 0) day = 1 + ((r.weekday - new Date(y, m0, 1).getDay() + 7) % 7) + 7 * (r.nth - 1)
    else day = n - ((new Date(y, m0, n).getDay() - r.weekday + 7) % 7)
  } else {
    const md = r.monthDay ?? 1
    day = md === -1 ? n : Math.min(md, n)
  }
  return ymd(new Date(y, m0, day))
}
const inYear = (r: Rule, y: number) => {
  const m0 = (r.month ?? 1) - 1
  return ymd(new Date(y, m0, Math.min(r.monthDay ?? 1, dim(y, m0))))
}

/** The first day after `d` the rule lands on, counting `d`'s own week /
    month / year as one it repeats in. */
export function nextAfter(r: Rule, d: string): string {
  const x = D(d)
  if (r.freq === 'day') return plus(d, r.every)
  if (r.freq === 'week') {
    const idx = mon0(x.getDay())
    const order = (r.days?.length ? r.days : [x.getDay()]).map(mon0).sort((a, b) => a - b)
    const later = order.find((i) => i > idx)
    return later != null ? plus(d, later - idx) : plus(d, 7 * r.every - idx + order[0])
  }
  if (r.freq === 'month') {
    const here = inMonth(r, x.getFullYear(), x.getMonth())
    if (here > d) return here
    const t = new Date(x.getFullYear(), x.getMonth() + r.every, 1)
    return inMonth(r, t.getFullYear(), t.getMonth())
  }
  const here = inYear(r, x.getFullYear())
  return here > d ? here : inYear(r, x.getFullYear() + r.every)
}

/** The first day on or after `due` the rule lands on (a new repeat starts
    there: "every Mon, Wed" made on a Saturday starts on Monday). */
export function firstOn(r: Rule, due: string): string {
  return r.freq === 'day' ? due : nextAfter({ ...r, every: 1 }, plus(due, -1))
}

/** Does a repeat whose latest day is `anchor` land on `day` (after it)? */
export function occursOn(r: Rule, anchor: string, day: string): boolean {
  if (day <= anchor) return false
  if (r.freq === 'day') return Math.round((D(day).getTime() - D(anchor).getTime()) / 86400_000) % r.every === 0
  let d = anchor
  for (let i = 0; i < 2000 && d < day; i++) d = nextAfter(r, d)
  return d === day
}

/** The next `n` days after `from` (or from `from` itself, with `include`). */
export function upcoming(r: Rule, from: string, n: number, include = false): string[] {
  const out: string[] = include ? [from] : []
  let d = from
  while (out.length < n) out.push((d = nextAfter(r, d)))
  return out
}

/** A rule in words: "Every weekday", "Every 2 weeks on Tue, Thu",
    "Monthly on the last Friday", "Yearly on 28 Nov". */
export function describeRule(
  r: Rule, t: (k: string, p?: Record<string, string | number>) => string, lang: string,
): string {
  const loc = lang === 'zh' ? 'zh-CN' : undefined
  // zh: 周六 reads right in every phrase (每周六, 第二个周六)
  const wd = (w: number, long = false) => new Date(2024, 0, 7 + w).toLocaleDateString(loc, { weekday: long && lang !== 'zh' ? 'long' : 'short' })
  const n = r.every
  if (r.freq === 'day') return n === 1 ? t('rep.daily') : t('rep.everyDays', { n })
  if (r.freq === 'week') {
    const days = [...(r.days ?? [])].sort((a, b) => mon0(a) - mon0(b))
    if (n === 1 && days.length === 7) return t('rep.daily')
    if (n === 1 && days.join() === '1,2,3,4,5') return t('rep.weekdays')
    const list = days.length === 1 ? wd(days[0], true) : days.map((d) => wd(d)).join(lang === 'zh' ? '、' : ', ')
    return n === 1 ? t('rep.weeklyOn', { days: list }) : t('rep.everyWeeksOn', { n, days: list })
  }
  if (r.freq === 'month') {
    let on: string
    if (r.nth != null && r.weekday != null) on = r.nth === -1 ? t('rep.lastWd', { wd: wd(r.weekday, true) }) : t('rep.nthWd', { nth: t(`rep.nth${r.nth}`), wd: wd(r.weekday, true) })
    else on = r.monthDay === -1 ? t('rep.lastDay') : t('rep.onDay', { d: r.monthDay ?? 1 })
    return n === 1 ? t('rep.monthlyOn', { on }) : t('rep.everyMonthsOn', { n, on })
  }
  const date = new Date(2024, (r.month ?? 1) - 1, r.monthDay ?? 1).toLocaleDateString(loc, { month: 'short', day: 'numeric' })
  return n === 1 ? t('rep.yearlyOn', { date }) : t('rep.everyYearsOn', { n, date })
}

/** A stored repeat in words ('' for one this version can't read). */
export function describeRepeat(
  stored: string | undefined, anchor: string, t: (k: string, p?: Record<string, string | number>) => string, lang: string,
): string {
  const r = parseRule(stored, anchor)
  return r ? describeRule(r, t, lang) : ''
}

/** What the task form's Repeat field holds. The presets follow the task's
    date (Weekly = on its weekday, Monthly = on its day, …) as they always
    have; a custom rule stays as set. */
export type RepeatPick =
  | { kind: 'off' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly' }
  | { kind: 'custom'; rule: Rule }
  | { kind: 'unknown'; raw: string }

export function pickFrom(stored: string | undefined, due: string): RepeatPick {
  if (!stored) return { kind: 'off' }
  if (stored === 'daily' || stored === 'weekly' || stored === 'monthly') return { kind: stored }
  if (stored === WEEKDAYS_RULE) return { kind: 'weekdays' }
  const r = parseRule(stored, due)
  if (!r) return { kind: 'unknown', raw: stored }
  const a = D(due)
  if (r.every === 1 && r.freq === 'month' && r.nth == null && r.monthDay === a.getDate()) return { kind: 'monthly' }
  if (r.every === 1 && r.freq === 'year' && r.month === a.getMonth() + 1 && r.monthDay === a.getDate()) return { kind: 'yearly' }
  return { kind: 'custom', rule: r }
}

/** The rule a pick stands for on a task dated `due` (null: off / unknown). */
export function pickRule(p: RepeatPick, due: string): Rule | null {
  const a = D(due)
  switch (p.kind) {
    case 'daily': return { freq: 'day', every: 1 }
    case 'weekdays': return { freq: 'week', every: 1, days: [1, 2, 3, 4, 5] }
    case 'weekly': return { freq: 'week', every: 1, days: [a.getDay()] }
    case 'monthly': return { freq: 'month', every: 1, monthDay: a.getDate() }
    case 'yearly': return { freq: 'year', every: 1, month: a.getMonth() + 1, monthDay: a.getDate() }
    case 'custom': return p.rule
    default: return null
  }
}

/** What to store, for a task that starts on `start`. */
export function pickValue(p: RepeatPick, start: string): string | undefined {
  if (p.kind === 'off') return undefined
  if (p.kind === 'unknown') return p.raw
  return ruleString(pickRule(p, start)!, start)
}

/** Where a task starts with this repeat: a new or changed repeat moves to
    the first day it lands on ("every Mon, Wed" set on a Saturday → Monday). */
export function pickStart(p: RepeatPick, due: string): string {
  const r = pickRule(p, due)
  return r ? firstOn(r, due) : due
}
