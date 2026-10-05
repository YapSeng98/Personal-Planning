import { Fragment, useEffect, useMemo, useState } from 'react'
import { todayStr, type Review } from '../db/db'
import { useLang } from '../lib/i18n'
import Icon from './Icon'

type RType = Review['type']

const MOOD_EMOJI: Record<string, string> = { great: '😊', good: '🙂', okay: '😐', bad: '☹️' }

const ymd = (d: Date) => todayStr(d)
const parse = (s: string) => new Date(s + 'T00:00')
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))

/** A month of reflections at a glance — instead of a list that grows: each
    day's mood (its energy as the tint), your streak, how many days you've
    reviewed, and the week / month / year reviews. Tap a day or a week to
    open its review, or to write one for a day you missed. */
export default function ReviewCalendar({ reviews, selected, onOpen }: {
  reviews: Review[]
  /** the review open on the page — the calendar shows its month */
  selected: { type: RType; start: string }
  onOpen: (type: RType, date: string) => void
}) {
  const { t, lang } = useLang()
  const locale = lang === 'zh' ? 'zh-CN' : 'en-US'
  const today = todayStr()
  const [month, setMonth] = useState(() => selected.start.slice(0, 8) + '01')
  // Follow the open review — but only when it isn't visible already: a week
  // that began last month, opened from this month's view, stays in view.
  const { type: selType, start: selStart } = selected
  useEffect(() => {
    setMonth((cur) => {
      const curEnd = ymd(new Date(Number(cur.slice(0, 4)), Number(cur.slice(5, 7)), 0))
      const st = selType, start = selStart
      const end = st === 'weekly' ? ymd(addDays(parse(start), 6))
        : st === 'monthly' ? ymd(new Date(Number(start.slice(0, 4)), Number(start.slice(5, 7)), 0))
          : st === 'yearly' ? `${start.slice(0, 4)}-12-31` : start
      return start <= curEnd && end >= cur ? cur : start.slice(0, 8) + '01'
    })
  }, [selType, selStart])

  const byType = useMemo(() => {
    const m: Record<RType, Map<string, Review>> = { daily: new Map(), weekly: new Map(), monthly: new Map(), yearly: new Map() }
    for (const r of reviews) if (!r.deleted && m[r.type]) m[r.type].set(r.periodStart, r)
    return m
  }, [reviews])

  const first = parse(month)
  const year = first.getFullYear(), mon = first.getMonth()
  const daysInMonth = new Date(year, mon + 1, 0).getDate()
  const thisMonth = today.slice(0, 8) + '01'
  const isCurrent = month === thisMonth
  const inFuture = month > thisMonth

  // Mon-first weeks covering the month
  const weeks = useMemo(() => {
    const out: { monday: string; days: string[] }[] = []
    const last = new Date(year, mon + 1, 0)
    for (let d = mondayOf(new Date(year, mon, 1)); d <= last; d = addDays(d, 7)) {
      const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(d, i)))
      out.push({ monday: days[0], days })
    }
    return out
  }, [year, mon])

  // consecutive days with a daily review, up to today (or yesterday, if
  // today's isn't written yet)
  const streak = useMemo(() => {
    let d = parse(today)
    if (!byType.daily.has(today)) d = addDays(d, -1)
    let n = 0
    while (byType.daily.has(ymd(d)) && n < 3660) { n++; d = addDays(d, -1) }
    return n
  }, [byType, today])

  const daysSoFar = isCurrent ? Number(today.slice(8, 10)) : inFuture ? 0 : daysInMonth
  let reviewed = 0
  for (let i = 1; i <= daysSoFar; i++) if (byType.daily.has(`${month.slice(0, 8)}${String(i).padStart(2, '0')}`)) reviewed++

  const weekdays = useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { weekday: 'narrow' })
    return Array.from({ length: 7 }, (_, i) => f.format(new Date(2024, 0, 1 + i))) // 2024-01-01 is a Monday
  }, [locale])
  const monthLabel = first.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const shift = (n: number) => setMonth(ymd(new Date(year, mon + n, 1)))

  const monthly = byType.monthly.get(month)
  const yearStart = `${year}-01-01`
  const yearly = byType.yearly.get(yearStart)
  const snippet = (r?: Review) => (r?.wins || r?.lesson || r?.nextPriorities || '').slice(0, 90)

  return (
    <div className="card rcal">
      <div className="rcal-head">
        <button type="button" className="rcal-nav" onClick={() => shift(-1)} aria-label={t('rev.prevMonth')} title={t('rev.prevMonth')}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <div className="rcal-title">{monthLabel}</div>
        <button type="button" className="rcal-nav" onClick={() => shift(1)} disabled={isCurrent || inFuture} aria-label={t('rev.nextMonth')} title={t('rev.nextMonth')}>
          <Icon name="chevronRight" size={16} />
        </button>
        {!isCurrent && <button type="button" className="btn rcal-today" onClick={() => setMonth(thisMonth)}>{t('rev.calToday')}</button>}
        <span className="rcal-badges">
          <button type="button" className={`rcal-badge ${monthly ? 'done' : ''} ${selected.type === 'monthly' && selected.start === month ? 'on' : ''}`}
            onClick={() => onOpen('monthly', month)} title={snippet(monthly) || t('rev.calWrite')}>
            {monthly && <Icon name="check" size={12} />} {t('rev.monthly')}
          </button>
          <button type="button" className={`rcal-badge ${yearly ? 'done' : ''} ${selected.type === 'yearly' && selected.start === yearStart ? 'on' : ''}`}
            onClick={() => onOpen('yearly', yearStart)} title={snippet(yearly) || t('rev.calWrite')}>
            {yearly && <Icon name="check" size={12} />} {year}
          </button>
        </span>
      </div>

      <div className="rcal-stats">
        {streak > 0 && <span className="rcal-streak">🔥 {t(streak === 1 ? 'rev.streak1' : 'rev.streak', { n: streak })}</span>}
        {daysSoFar > 0 && (
          <span className="rcal-count">
            <span className="rcal-meter"><span style={{ width: `${(reviewed / daysSoFar) * 100}%` }} /></span>
            {t('rev.monthCount', { n: reviewed, total: daysSoFar })}
          </span>
        )}
      </div>

      <div className="rcal-grid" role="grid" aria-label={monthLabel}>
        <span className="rcal-wh" />
        {weekdays.map((w, i) => <span key={i} className="rcal-wh">{w}</span>)}
        {weeks.map((w) => {
          const wr = byType.weekly.get(w.monday)
          const weekFuture = w.monday > today
          return (
            <Fragment key={w.monday}>
              <button type="button"
                className={`rcal-wk ${wr ? 'done' : ''} ${selected.type === 'weekly' && selected.start === w.monday ? 'on' : ''}`}
                disabled={weekFuture} onClick={() => onOpen('weekly', w.monday)}
                title={`${t('rev.calWeek', { date: w.monday })}${wr ? ' — ' + snippet(wr) : ''}`}
                aria-label={t('rev.calWeek', { date: w.monday })}>
                {t('rev.weekShort')}
              </button>
              {w.days.map((d) => {
                const r = byType.daily.get(d)
                const future = d > today
                const inMonth = d.slice(0, 7) === month.slice(0, 7)
                const on = selected.type === 'daily' && selected.start === d
                const tip = r ? `${d}${snippet(r) ? ' — ' + snippet(r) : ''}` : future ? d : `${d} — ${t('rev.calWrite')}`
                return (
                  <button key={d} type="button" disabled={future}
                    className={`rcal-day ${inMonth ? '' : 'out'} ${r ? 'has' : ''} ${d === today ? 'today' : ''} ${on ? 'on' : ''}`}
                    style={r ? ({ '--e': r.energy ?? 1.5 } as React.CSSProperties) : undefined}
                    onClick={() => onOpen('daily', d)} title={tip} aria-label={tip} aria-pressed={on}>
                    <span className="rcal-num">{Number(d.slice(8, 10))}</span>
                    {r && <span className="rcal-mood" aria-hidden>{r.mood ? MOOD_EMOJI[r.mood] : '•'}</span>}
                  </button>
                )
              })}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}
