import Select from './Select'
import { useLang } from '../lib/i18n'
import { upcoming, describeRule, pickRule, type RepeatPick, type Rule, type Freq } from '../lib/repeat'

const D = (s: string) => new Date(s + 'T00:00')
const monthKey = (r: Rule) => `${r.nth ?? ''}|${r.weekday ?? ''}|${r.nth == null ? r.monthDay : ''}`
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const FREQ_ORDER: Freq[] = ['day', 'week', 'month', 'year']
const WEEK = [1, 2, 3, 4, 5, 6, 0]

export default function RepeatPicker({ pick, due, onChange, start }: {
  pick: RepeatPick
  due: string
  onChange: (p: RepeatPick) => void
  /** the day the task will start on (shown when it isn't `due`) */
  start: string
}) {
  const { t, lang } = useLang()
  const loc = lang === 'zh' ? 'zh-CN' : undefined
  const describe = (p: RepeatPick) => describeRule(pickRule(p, due)!, t, lang)
  const dayLabel = (d: string) => D(d).toLocaleDateString(loc, { weekday: 'short', day: 'numeric', month: 'short' })

  const options = [
    { value: 'off', label: t('task.repeatOff') },
    ...(['daily', 'weekdays', 'weekly', 'monthly', 'yearly'] as const).map((kind) => ({ value: kind, label: describe({ kind }) })),
    ...(pick.kind === 'unknown' ? [{ value: 'unknown', label: t('rep.unknown') }] : []),
    { value: 'custom', label: pick.kind === 'custom' ? describe(pick) : t('rep.custom') },
  ]
  const choose = (v: string) => {
    if (v === pick.kind && v !== 'custom') return
    if (v === 'custom') {
      if (pick.kind === 'custom') return
      // start from what's chosen now (Every weekday → Mon–Fri ticked)
      onChange({ kind: 'custom', rule: pickRule(pick, due) ?? { freq: 'week', every: 1, days: [D(due).getDay()] } })
    } else if (v !== 'unknown') onChange({ kind: v as 'off' })
  }

  const rule = pick.kind === 'custom' ? pick.rule : null
  const rr = pickRule(pick, due)
  const next = rr && pick.kind !== 'daily' ? upcoming(rr, start, 3, true) : []

  return (
    <>
      <Select ariaLabel={t('task.repeat')} value={pick.kind} onChange={choose} options={options} />
      {rule && <CustomRule rule={rule} due={due} onChange={(r) => onChange({ kind: 'custom', rule: r })} />}
      {start !== due && <p className="hint rep-hint">{t('rep.starts', { date: dayLabel(start) })}</p>}
      {(rule || pick.kind === 'weekdays') && next.length > 0 && (
        <p className="hint rep-hint">{t('rep.next', { dates: next.map(dayLabel).join(' · ') })}</p>
      )}
    </>
  )
}

function CustomRule({ rule, due, onChange }: { rule: Rule; due: string; onChange: (r: Rule) => void }) {
  const { t, lang } = useLang()
  const loc = lang === 'zh' ? 'zh-CN' : undefined
  const a = D(due)
  const wdName = (w: number, style: 'long' | 'short' | 'narrow') => new Date(2024, 0, 7 + w).toLocaleDateString(loc, { weekday: style })

  const setFreq = (freq: Freq) => {
    if (freq === rule.freq) return
    const every = rule.every
    if (freq === 'day') onChange({ freq, every })
    else if (freq === 'week') onChange({ freq, every, days: [a.getDay()] })
    else if (freq === 'month') onChange({ freq, every, monthDay: a.getDate() })
    else onChange({ freq, every, month: a.getMonth() + 1, monthDay: a.getDate() })
  }
  const toggleDay = (w: number) => {
    const days = rule.days ?? []
    if (days.includes(w)) { if (days.length > 1) onChange({ ...rule, days: days.filter((d) => d !== w) }) }
    else onChange({ ...rule, days: [...days, w] })
  }

  // a month's choices, from the task's date — plus the rule's own if it's another
  const monthOpts: Rule[] = []
  if (rule.freq === 'month') {
    const dom = a.getDate(), last = new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate()
    const base = { freq: 'month' as const, every: rule.every }
    monthOpts.push({ ...base, monthDay: dom })
    if (Math.ceil(dom / 7) <= 4) monthOpts.push({ ...base, nth: Math.ceil(dom / 7), weekday: a.getDay() })
    if (dom + 7 > last) monthOpts.push({ ...base, nth: -1, weekday: a.getDay() })
    monthOpts.push({ ...base, monthDay: -1 })
    if (!monthOpts.some((o) => monthKey(o) === monthKey(rule))) monthOpts.unshift(rule)
  }
  const onLabel = (r: Rule) => {
    const s = describeRule({ ...r, every: 1 }, t, lang)
    // "Monthly on the last Friday" → "On the last Friday"
    return cap(lang === 'zh' ? s.replace(/^每月/, '') : s.replace(/^Monthly /, ''))
  }

  return (
    <div className="rep-custom">
      <div className="rep-row">
        <span className="rep-lbl">{t('rep.every')}</span>
        <div className="rep-step">
          <button type="button" aria-label={t('rep.fewer')} disabled={rule.every <= 1} onClick={() => onChange({ ...rule, every: rule.every - 1 })}>−</button>
          <b aria-live="polite">{rule.every}</b>
          <button type="button" aria-label={t('rep.more')} disabled={rule.every >= 99} onClick={() => onChange({ ...rule, every: rule.every + 1 })}>+</button>
        </div>
        <div className="rep-seg" role="radiogroup" aria-label={t('rep.unit')}>
          {FREQ_ORDER.map((f) => (
            <button key={f} type="button" role="radio" aria-checked={rule.freq === f} className={rule.freq === f ? 'on' : ''} onClick={() => setFreq(f)}>
              {t(`rep.u.${f}${rule.every === 1 ? '1' : ''}`)}
            </button>
          ))}
        </div>
      </div>
      {rule.freq === 'week' && (
        <div className="rep-days" role="group" aria-label={t('rep.onDays')}>
          {WEEK.map((w) => {
            const on = !!rule.days?.includes(w)
            return (
              <button key={w} type="button" className={on ? 'on' : ''} aria-pressed={on} aria-label={wdName(w, 'long')} onClick={() => toggleDay(w)}>
                {lang === 'zh' ? wdName(w, 'short').replace('周', '') : wdName(w, 'narrow')}
              </button>
            )
          })}
        </div>
      )}
      {rule.freq === 'month' && (
        <div className="quick-dates rep-month" role="radiogroup" aria-label={t('rep.onDays')}>
          {monthOpts.map((o) => {
            const on = monthKey(o) === monthKey(rule)
            return (
              <button key={monthKey(o)} type="button" role="radio" aria-checked={on} className={`qd ${on ? 'on' : ''}`} onClick={() => onChange(o)}>
                {onLabel(o)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
