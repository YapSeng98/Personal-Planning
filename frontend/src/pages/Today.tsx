import { useEffect, useState, useCallback } from 'react'
import { db, todayStr, uuid, writeAndQueue, habitStreak, rollUpGoal, cleanEmoji, CHANGED, type Task, type Habit, type Project } from '../db/db'
import { syncNow } from '../sync/engine'
import { currentUser } from '../sync/api'
import { projectColorVar } from '../lib/projectColors'
import Insights from '../components/Insights'
import TaskForm from '../components/TaskForm'
import HabitEdit from '../components/HabitEdit'
import { useLang, type TFn } from '../lib/i18n'

interface HabitView extends Habit {
  doneToday: number
  streak: number
}

function greeting(t: TFn): [string, string] {
  const h = new Date().getHours()
  if (h < 12) return [t('today.morning'), '☀️']
  if (h < 18) return [t('today.afternoon'), '🌤️']
  return [t('today.evening'), '🌙']
}

/** Rule-based briefing (parameterized so it translates). */
function briefingText(tasks: Task[], t: TFn): string {
  const open = tasks.filter((x) => x.state !== 'done' && x.state !== 'cancelled')
  const done = tasks.filter((x) => x.state === 'done')
  if (tasks.length === 0) return t('brief.cleanSlate')
  if (open.length === 0) return t('brief.allDone', { n: done.length })
  const mit = open.find((x) => x.isMit)
  const next = open
    .filter((x) => x.timeBlockStart)
    .sort((a, b) => a.timeBlockStart!.localeCompare(b.timeBlockStart!))[0]
  const parts: string[] = []
  if (done.length > 0) parts.push(t('brief.momentum', { done: done.length, left: open.length }))
  else parts.push(t('brief.planned', { n: open.length }))
  if (mit) parts.push(t('brief.mit', { title: mit.title }))
  if (next?.timeBlockStart) parts.push(t('brief.next', { time: next.timeBlockStart.slice(11, 16) }))
  return parts.join(' ')
}

/** Priority → accent colour on a task card (1–2 urgent, 3 mid, 4–5 easy). */
function accentFor(p: number): string {
  if (p <= 2) return 'var(--accent)'
  if (p === 3) return 'var(--amber)'
  return 'var(--ok)'
}

/** Build the weekly momentum sparkline paths from 7 daily done-counts. */
function areaPath(series: number[]) {
  const max = Math.max(1, ...series)
  const w = 160, h = 40
  const pts = series.map((v, i) => [(i / (series.length - 1)) * w, h - (v / max) * h] as const)
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  return { line, area: `${line} L${w},${h} L0,${h} Z`, last: pts[pts.length - 1] }
}

interface Momentum { series: number[]; weekDone: number; streak: number }

export default function Today() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [habits, setHabits] = useState<HabitView[]>([])
  const [projects, setProjects] = useState<Record<string, Project>>({})
  const [mom, setMom] = useState<Momentum>({ series: [0, 0, 0, 0, 0, 0, 0], weekDone: 0, streak: 0 })
  const [editing, setEditing] = useState<Task | null>(null)
  const [editingHabit, setEditingHabit] = useState<Habit | 'new' | null>(null)
  const { t, lang } = useLang()
  const today = todayStr()

  const load = useCallback(async () => {
    const rows = await db.tasks.where('due').equals(today).and((x) => !x.deleted).toArray()
    rows.sort((a, b) => (a.timeBlockStart ?? 'z').localeCompare(b.timeBlockStart ?? 'z'))
    setTasks(rows)

    const projRows = await db.projects.filter((p) => !p.deleted).toArray()
    setProjects(Object.fromEntries(projRows.map((p) => [p.id, p])))

    const hs = await db.habits.where('active').equals(1).and((x) => !x.deleted).toArray()
    const views: HabitView[] = []
    for (const h of hs) {
      const log = await db.habitLogs.where('[habitId+date]').equals([h.id, today]).first()
      views.push({ ...h, doneToday: log?.count ?? 0, streak: await habitStreak(h.id) })
    }
    setHabits(views)

    // momentum: last 7 days of completed tasks + best active streak
    const series: number[] = []
    for (let d = 6; d >= 0; d--) {
      const date = todayStr(new Date(Date.now() - d * 86400_000))
      series.push(
        await db.tasks.where('due').equals(date).and((x) => x.state === 'done' && !x.deleted).count(),
      )
    }
    let best = 0
    for (const h of hs) best = Math.max(best, await habitStreak(h.id))
    setMom({ series, weekDone: series.reduce((s, n) => s + n, 0), streak: best })
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

  const dateLabel = new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })

  const [hello, emoji] = greeting(t)
  const name = currentUser()
  const doneCount = tasks.filter((x) => x.state === 'done').length
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0
  const spark = areaPath(mom.series)

  return (
    <div className="today-grid">
    <div className="ga-hero">
      {/* ---- sunrise hero ---- */}
      <div className={`hero-card ${tasks.length > 0 ? 'has-ring' : ''}`}>
        <div className="hero-wm">{t('brand')}</div>
        <div className="hero-hi">{hello}{name ? `, ${name}` : ''} {emoji}</div>
        <div className="hero-dt">{dateLabel}</div>
        <div className="hero-brief">
          <div className="bl">✦ {t('today.briefing')}</div>
          <div className="bt">{briefingText(tasks, t)}</div>
        </div>
        {tasks.length > 0 && (
          <div className="hero-ring" style={{ ['--p' as string]: pct }} aria-label={`${pct}% of today done`}>
            <i>{pct}%</i>
          </div>
        )}
      </div>
    </div>

    <div className="ga-side">
      {/* ---- momentum ---- */}
      <div className="momentum">
        <div className="m-card m-chart">
          <div className="ct">{t('ins.weekMomentum')}</div>
          <div className="cv num">{mom.weekDone} <small>{t('an.tasks')}</small></div>
          <svg viewBox="0 0 160 40" preserveAspectRatio="none" role="img" aria-label={`${mom.weekDone} tasks done this week`}>
            <defs>
              <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--accent)" stopOpacity="0.4" />
                <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={spark.area} fill="url(#spark)" />
            <path d={spark.line} fill="none" stroke="var(--accent-bright)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx={spark.last[0]} cy={spark.last[1]} r="3.4" fill="var(--amber)" stroke="var(--surface)" strokeWidth="2" />
          </svg>
        </div>
        <div className="m-card m-streak">
          <div className="big num">{mom.streak}</div>
          <div className="sl">{t(mom.streak === 1 ? 'ins.day' : 'ins.days')} 🔥</div>
        </div>
      </div>

      <div className="section-h">{t('today.habits')}</div>
      <div className="habit-row">
        {habits.map((h) => {
          const hp = Math.min(100, (h.doneToday / h.targetPerDay) * 100)
          return (
            <div key={h.id} className="habit-cell">
              <button
                className="ring-btn"
                style={{ ['--p' as string]: hp }}
                onClick={() => tickHabit(h)}
                aria-label={`${h.name}: ${h.doneToday} of ${h.targetPerDay} today. Tap to log.`}
              >
                <span className="ring">{cleanEmoji(h.emoji, h.name)}</span>
              </button>
              <button className="habit-name-btn" onClick={() => setEditingHabit(h)} title="Tap to edit">
                {h.name}
              </button>
              <span className="streak num">
                {h.targetPerDay > 1 ? `${h.doneToday}/${h.targetPerDay}` : h.streak > 0 ? `${h.streak}d 🔥` : '—'}
              </span>
            </div>
          )
        })}
        <div className="habit-cell">
          <button className="ring-btn" onClick={() => setEditingHabit('new')} aria-label="Add a habit">
            <span className="ring add">＋</span>
          </button>
          <span className="habit-name-btn" style={{ cursor: 'default' }}>
            {habits.length === 0 ? t('today.addFirstHabit') : t('today.add')}
          </span>
        </div>
      </div>
      <Insights />
    </div>

    <div className="ga-tasks">
      <div className="section-h">{t('today.tasks')}</div>
      {tasks.length === 0 ? (
        <div className="card empty-cta">
          <p>{t('today.emptyTasks')}</p>
          <button className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('planner:quickadd'))}>
            {t('today.addFirstTask')}
          </button>
        </div>
      ) : (
        <div className="tstack">
          {tasks.map((task) => {
            const proj = task.projectId ? projects[task.projectId] : undefined
            const done = task.state === 'done'
            return (
              <div key={task.id} className="tcard">
                <span className="acc" style={{ background: done ? 'var(--ok)' : accentFor(task.priority) }} />
                <button
                  className={`check ${done ? 'on' : ''}`}
                  onClick={() => toggleTask(task)}
                  aria-label={task.title}
                >
                  ✓
                </button>
                <button className="tbody" onClick={() => setEditing(task)} title={task.title}>
                  <div className={`ttitle ${done ? 'done' : ''}`}>{task.title}</div>
                  {(Boolean(task.isMit) || proj) && (
                    <div className="tmeta">
                      {Boolean(task.isMit) && <span className="tstar">⭐</span>}
                      {proj && (
                        <span className="tchip" style={{ background: 'var(--accent-wash)', color: 'var(--text-2)' }}>
                          <span className="cd" style={{ background: projectColorVar(proj.color) }} />
                          {proj.title}
                        </span>
                      )}
                    </div>
                  )}
                </button>
                <span className={`ttime ${task.timeBlockStart ? '' : 'faint'}`}>
                  {task.timeBlockStart
                    ? `${task.timeBlockStart.slice(11, 16)}${task.timeBlockEnd ? `–${task.timeBlockEnd.slice(11, 16)}` : ''}`
                    : t('today.anytime')}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
    {editing && <TaskForm task={editing} onClose={() => setEditing(null)} />}
    {editingHabit && (
      <HabitEdit habit={editingHabit === 'new' ? null : editingHabit} onClose={() => setEditingHabit(null)} />
    )}
    </div>
  )
}
