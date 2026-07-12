import { useEffect, useState, useCallback } from 'react'
import { db, todayStr, uuid, writeAndQueue, habitStreak, rollUpGoal, CHANGED, type Task, type Habit } from '../db/db'
import { syncNow } from '../sync/engine'
import Insights from '../components/Insights'

interface HabitView extends Habit {
  doneToday: number
  streak: number
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Rule-based briefing for Phase 1; the AI assistant takes over this card in Phase 3. */
function briefingText(tasks: Task[]): string {
  const open = tasks.filter((t) => t.state === 'open')
  const done = tasks.filter((t) => t.state === 'done')
  if (tasks.length === 0) return 'A clean slate. Add your first task with the + button — small starts count.'
  if (open.length === 0) return `All ${done.length} done — that's a full sweep. Enjoy the win! 🎉`
  const mit = open.find((t) => t.isMit)
  const next = open
    .filter((t) => t.timeBlockStart)
    .sort((a, b) => a.timeBlockStart!.localeCompare(b.timeBlockStart!))[0]
  const parts: string[] = []
  if (done.length > 0) parts.push(`${done.length} down, ${open.length} to go — good momentum.`)
  else parts.push(`${open.length} planned today. One block at a time.`)
  if (mit) parts.push(`Your most important task: ${mit.title}.`)
  if (next?.timeBlockStart) parts.push(`Next block at ${next.timeBlockStart.slice(11, 16)}.`)
  return parts.join(' ')
}

export default function Today() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [habits, setHabits] = useState<HabitView[]>([])
  const today = todayStr()

  const load = useCallback(async () => {
    const t = await db.tasks.where('due').equals(today).and((x) => !x.deleted).toArray()
    t.sort((a, b) => (a.timeBlockStart ?? 'z').localeCompare(b.timeBlockStart ?? 'z'))
    setTasks(t)

    const hs = await db.habits.where('active').equals(1).and((x) => !x.deleted).toArray()
    const views: HabitView[] = []
    for (const h of hs) {
      const log = await db.habitLogs.where('[habitId+date]').equals([h.id, today]).first()
      views.push({ ...h, doneToday: log?.count ?? 0, streak: await habitStreak(h.id) })
    }
    setHabits(views)
  }, [today])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  async function toggleTask(t: Task) {
    const updated: Task = { ...t, state: t.state === 'done' ? 'open' : 'done', updatedAt: Date.now() }
    await writeAndQueue(db.tasks, 'task', updated)
    if (updated.goalId) await rollUpGoal(updated.goalId)
    syncNow()
  }

  async function tickHabit(h: HabitView) {
    const existing = await db.habitLogs.where('[habitId+date]').equals([h.id, today]).first()
    const next = existing
      ? { ...existing, count: existing.count >= h.targetPerDay ? 0 : existing.count + 1, updatedAt: Date.now() }
      : { id: uuid(), habitId: h.id, date: today, count: 1, deleted: 0 as const, updatedAt: Date.now() }
    await writeAndQueue(db.habitLogs, 'habit_log', next)
    await load()
    syncNow()
  }

  const dateLabel = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const blocks = tasks.filter((t) => t.timeBlockStart).length

  return (
    <div className="today-grid">
    <div>
      <div className="greet">
        <h1>{greeting()} ☀️</h1>
        <div className="sub">
          {dateLabel}
          {blocks > 0 ? ` · ${blocks} ${blocks === 1 ? 'block' : 'blocks'} planned` : ''}
        </div>
      </div>

      <div className="stack">
        <div className="card card-ai briefing">
          <div className="lbl grad-text">✦ Briefing</div>
          <div className="txt">{briefingText(tasks)}</div>
        </div>
      </div>

      <div className="section-h">Habits</div>
      {habits.length === 0 ? (
        <div className="empty">No habits yet — they'll appear here once added.</div>
      ) : (
        <div className="habit-row">
          {habits.map((h) => {
            const pct = Math.min(100, (h.doneToday / h.targetPerDay) * 100)
            return (
              <button
                key={h.id}
                className="habit-cell"
                style={{ ['--p' as string]: pct }}
                onClick={() => tickHabit(h)}
                aria-label={`${h.name}: ${h.doneToday} of ${h.targetPerDay} today. Tap to log.`}
              >
                <span className="ring">{h.emoji}</span>
                <span className="name">{h.name}</span>
                <br />
                <span className="streak num">
                  {h.targetPerDay > 1 ? `${h.doneToday}/${h.targetPerDay}` : h.streak > 0 ? `${h.streak}d 🔥` : '—'}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div className="section-h">Today's tasks</div>
      <div className="stack" style={{ marginTop: 0 }}>
        {tasks.length === 0 && <div className="empty">Nothing planned yet. Tap + to add your first task.</div>}
        {tasks.map((t) => (
          <div key={t.id} className="card task-row">
            <button
              className={`check ${t.state === 'done' ? 'on' : ''}`}
              onClick={() => toggleTask(t)}
              aria-label={t.state === 'done' ? `Mark ${t.title} not done` : `Complete ${t.title}`}
            >
              ✓
            </button>
            <span className={`title ${t.state === 'done' ? 'done' : ''}`}>{t.title}</span>
            {t.isMit && <span className="chip">MIT</span>}
            {t.timeBlockStart && (
              <span className="when num">
                {t.timeBlockStart.slice(11, 16)}
                {t.timeBlockEnd ? `–${t.timeBlockEnd.slice(11, 16)}` : ''}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
    <Insights />
    </div>
  )
}
