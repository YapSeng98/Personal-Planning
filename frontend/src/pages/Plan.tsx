import { useEffect, useState, useCallback } from 'react'
import { db, uuid, todayStr, writeAndQueue, rollUpGoal, CHANGED, type Task, type Goal } from '../db/db'
import { syncNow } from '../sync/engine'
import TaskForm from '../components/TaskForm'
import { useLang, type TFn } from '../lib/i18n'

interface DayView {
  date: string
  name: string
  tasks: Task[]
}

function relativeWeek(offset: number, t: TFn): string {
  if (offset === 0) return t('plan.thisWeek')
  if (offset === -1) return t('plan.lastWeek')
  if (offset === 1) return t('plan.nextWeek')
  return offset < 0 ? t('plan.weeksAgo', { n: -offset }) : t('plan.inWeeks', { n: offset })
}

export default function Plan() {
  const [days, setDays] = useState<DayView[]>([])
  const [monthGoals, setMonthGoals] = useState<Goal[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Task | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const { t, lang } = useLang()
  const today = todayStr()

  const load = useCallback(async () => {
    // Monday of the week being viewed (weekOffset weeks from this week).
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7)
    const views: DayView[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const date = todayStr(d)
      const tasks = await db.tasks.where('due').equals(date).and((x) => !x.deleted).toArray()
      tasks.sort((a, b) => (a.timeBlockStart ?? 'z').localeCompare(b.timeBlockStart ?? 'z'))
      views.push({ date, name: d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : undefined, { weekday: 'long' }), tasks })
    }
    setDays(views)
    setMonthGoals(await db.goals.filter((g) => g.type === 'month' && !g.deleted).toArray())
  }, [weekOffset, lang])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  async function toggle(t: Task) {
    const updated: Task = { ...t, state: t.state === 'done' ? 'open' : 'done', updatedAt: Date.now() }
    await writeAndQueue(db.tasks, 'task', updated)
    if (updated.goalId) await rollUpGoal(updated.goalId)
    syncNow()
  }

  async function addFor(date: string) {
    const text = (drafts[date] ?? '').trim()
    if (!text) return
    await writeAndQueue(db.tasks, 'task', {
      id: uuid(),
      title: text,
      state: 'open',
      priority: 3,
      due: date,
      deleted: 0,
      updatedAt: Date.now(),
    })
    setDrafts((d) => ({ ...d, [date]: '' }))
    await load()
    syncNow()
  }

  const locale = lang === 'zh' ? 'zh-CN' : undefined
  const monthName = new Date().toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const weekDone = days.reduce((s, d) => s + d.tasks.filter((x) => x.state === 'done').length, 0)
  const weekTotal = days.reduce((s, d) => s + d.tasks.length, 0)
  const fmt = (s?: string) => (s ? new Date(s + 'T00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric' }) : '')
  const weekRange = days.length ? `${fmt(days[0].date)} – ${fmt(days[6].date)}` : ''

  return (
    <div>
      <div className="greet">
        <h1>{t('plan.title')}</h1>
        <div className="sub">{t('plan.sub', { month: monthName })}</div>
      </div>

      <div className="week-nav">
        <button className="wk-arrow" onClick={() => setWeekOffset((o) => o - 1)} aria-label="Previous week">‹</button>
        <div className="wk-mid">
          <div className="wk-rel">{relativeWeek(weekOffset, t)}</div>
          <div className="wk-range num">{weekRange}{weekTotal > 0 ? ` · ${weekDone}/${weekTotal} ${t('plan.done')}` : ''}</div>
        </div>
        <button className="wk-arrow" onClick={() => setWeekOffset((o) => o + 1)} aria-label="Next week">›</button>
      </div>
      {weekOffset !== 0 && (
        <button className="wk-today" onClick={() => setWeekOffset(0)}>{t('plan.backToWeek')}</button>
      )}

      {monthGoals.length > 0 && (
        <>
          <div className="section-h">{t('plan.monthGoals')}</div>
          <div className="stack plan-month-goals" style={{ marginTop: 0 }}>
            {monthGoals.map((g) => (
              <div key={g.id} className="card goal-card">
                <div className="top">
                  <span className="t">{g.title}</span>
                  <span className="pct num">{g.progress}%</span>
                </div>
                <div className="pbar"><i style={{ width: `${g.progress}%` }} /></div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="stack week-days" style={{ marginTop: '0.6rem' }}>
        {days.map((d) => (
          <div key={d.date} className="card day-card">
            <div className="day-h">
              <span className={`d ${d.date === today ? 'today-mark' : ''}`}>
                {d.name}{d.date === today ? ` · ${t('common.today')}` : ''}
              </span>
              <span className="n num">{d.date.slice(5)}</span>
            </div>
            {d.tasks.map((task) => (
              <div key={task.id} className="task-row">
                <button
                  className={`check ${task.state === 'done' ? 'on' : ''}`}
                  onClick={() => toggle(task)}
                  aria-label={task.title}
                >
                  ✓
                </button>
                <button className={`title title-btn ${task.state === 'done' ? 'done' : ''}`} onClick={() => setEditing(task)} title={task.title}>
                  {task.title}
                </button>
                <span className={`when num ${task.timeBlockStart ? '' : 'faint'}`}>
                  {task.timeBlockStart ? task.timeBlockStart.slice(11, 16) : t('today.anytime')}
                </span>
              </div>
            ))}
            <input
              className="add-inline"
              type="text"
              placeholder={t('plan.addTask')}
              value={drafts[d.date] ?? ''}
              onChange={(e) => setDrafts((dr) => ({ ...dr, [d.date]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && addFor(d.date)}
              aria-label={t('plan.addTask')}
            />
          </div>
        ))}
      </div>
      {editing && <TaskForm task={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
