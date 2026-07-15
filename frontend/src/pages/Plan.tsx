import { useEffect, useState, useCallback } from 'react'
import { db, uuid, todayStr, writeAndQueue, rollUpGoal, CHANGED, type Task, type Goal } from '../db/db'
import { syncNow } from '../sync/engine'
import TaskEdit from '../components/TaskEdit'

interface DayView {
  date: string
  name: string
  tasks: Task[]
}

export default function Plan() {
  const [days, setDays] = useState<DayView[]>([])
  const [monthGoals, setMonthGoals] = useState<Goal[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Task | null>(null)
  const today = todayStr()

  const load = useCallback(async () => {
    // Current week, Monday first.
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    const views: DayView[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const date = todayStr(d)
      const tasks = await db.tasks.where('due').equals(date).and((t) => !t.deleted).toArray()
      tasks.sort((a, b) => (a.timeBlockStart ?? 'z').localeCompare(b.timeBlockStart ?? 'z'))
      views.push({ date, name: d.toLocaleDateString(undefined, { weekday: 'long' }), tasks })
    }
    setDays(views)
    setMonthGoals(await db.goals.filter((g) => g.type === 'month' && !g.deleted).toArray())
  }, [])

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

  const monthName = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div>
      <div className="greet">
        <h1>Plan</h1>
        <div className="sub">{monthName} — month goals and this week, day by day.</div>
      </div>

      {monthGoals.length > 0 && (
        <>
          <div className="section-h">Month goals</div>
          <div className="stack" style={{ marginTop: 0 }}>
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

      <div className="section-h">This week</div>
      <div className="stack" style={{ marginTop: 0 }}>
        {days.map((d) => (
          <div key={d.date} className="card day-card">
            <div className="day-h">
              <span className={`d ${d.date === today ? 'today-mark' : ''}`}>
                {d.name}{d.date === today ? ' · today' : ''}
              </span>
              <span className="n num">{d.date.slice(5)}</span>
            </div>
            {d.tasks.map((t) => (
              <div key={t.id} className="task-row">
                <button
                  className={`check ${t.state === 'done' ? 'on' : ''}`}
                  onClick={() => toggle(t)}
                  aria-label={t.state === 'done' ? `Mark ${t.title} not done` : `Complete ${t.title}`}
                >
                  ✓
                </button>
                <button className={`title title-btn ${t.state === 'done' ? 'done' : ''}`} onClick={() => setEditing(t)} title="Tap to edit">
                  {t.title}
                </button>
                <span className={`when num ${t.timeBlockStart ? '' : 'faint'}`}>
                  {t.timeBlockStart ? t.timeBlockStart.slice(11, 16) : 'anytime'}
                </span>
              </div>
            ))}
            <input
              className="add-inline"
              type="text"
              placeholder="+ add task"
              value={drafts[d.date] ?? ''}
              onChange={(e) => setDrafts((dr) => ({ ...dr, [d.date]: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && addFor(d.date)}
              aria-label={`Add task for ${d.name}`}
            />
          </div>
        ))}
      </div>
      {editing && <TaskEdit task={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
