import { useEffect, useState, useCallback, useRef } from 'react'
import {
  DndContext, useDroppable, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCorners, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  db, uuid, todayStr, writeAndQueue, rollUpGoal, byOrder, activeRecurringSeries, isProjectedOccurrence, nextCompletedAt, CHANGED,
  type Task, type TaskState, type Goal, type Habit, type Review,
} from '../db/db'
import { syncNow } from '../sync/engine'
import TaskForm from '../components/TaskForm'
import { useLang, type TFn } from '../lib/i18n'

interface DayView {
  date: string
  name: string
  tasks: Task[]
  /** Recurring tasks projected onto this day even though no real row exists
      here yet — e.g. the rest of this week for a daily task. Titles only;
      not interactive, since there's nothing to check off until it's real. */
  previews: string[]
}

interface MonthCell {
  date: string
  inMonth: boolean
  done: number
  total: number
  habitsDone: number
  habitsTotal: number
  mood?: Review['mood']
}

const MOOD_EMOJI: Record<NonNullable<Review['mood']>, string> = { great: '😊', good: '🙂', okay: '😐', bad: '☹️' }

function relativeWeek(offset: number, t: TFn): string {
  if (offset === 0) return t('plan.thisWeek')
  if (offset === -1) return t('plan.lastWeek')
  if (offset === 1) return t('plan.nextWeek')
  return offset < 0 ? t('plan.weeksAgo', { n: -offset }) : t('plan.inWeeks', { n: offset })
}

function relativeMonth(offset: number, t: TFn): string {
  if (offset === 0) return t('plan.thisMonth')
  if (offset === -1) return t('plan.lastMonth')
  if (offset === 1) return t('plan.nextMonth')
  return offset < 0 ? t('plan.monthsAgo', { n: -offset }) : t('plan.inMonths', { n: offset })
}

function TaskRow({ task, onToggle, onEdit, t }: { task: Task; onToggle: () => void; onEdit: () => void; t: TFn }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="task-row"
    >
      <button className="drag-grip" aria-label="Drag to reorder" {...listeners} {...attributes}>⠿</button>
      <button className={`check ${task.state === 'done' ? 'on' : ''}`} onClick={onToggle} aria-label={task.title}>✓</button>
      <button className={`title title-btn ${task.state === 'done' ? 'done' : ''}`} onClick={onEdit} title={task.title}>
        {task.recurrence && <span title={t('task.repeat')}>🔁 </span>}{task.title}
      </button>
      <span className={`when num ${task.timeBlockStart ? '' : 'faint'}`}>
        {task.timeBlockStart ? task.timeBlockStart.slice(11, 16) : t('today.anytime')}
      </span>
    </div>
  )
}

function DayColumn({
  day, today, draft, onDraft, onAdd, onToggle, onEdit, t,
}: {
  day: DayView
  today: string
  draft: string
  onDraft: (v: string) => void
  onAdd: () => void
  onToggle: (task: Task) => void
  onEdit: (task: Task) => void
  t: TFn
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day.date })
  return (
    <div ref={setNodeRef} className={`card day-card ${day.date === today ? 'is-today' : ''} ${isOver ? 'drop-over' : ''}`}>
      <div className="day-h">
        <span className={`d ${day.date === today ? 'today-mark' : ''}`}>
          {day.name}{day.date === today ? ` · ${t('common.today')}` : ''}
        </span>
        <span className="n num">{day.date.slice(5)}</span>
      </div>
      <SortableContext items={day.tasks.map((x) => x.id)} strategy={verticalListSortingStrategy}>
        {day.tasks.map((task) => (
          <TaskRow key={task.id} task={task} onToggle={() => onToggle(task)} onEdit={() => onEdit(task)} t={t} />
        ))}
      </SortableContext>
      {day.previews.map((title, i) => (
        <div key={i} className="task-row preview-row" title={t('plan.previewHint')}>
          <span className="drag-grip" aria-hidden />
          <span className="check" aria-hidden>&#8635;</span>
          <span className="title">{title}</span>
        </div>
      ))}
      <input
        className="add-inline"
        type="text"
        placeholder={t('plan.addTask')}
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && onAdd()}
        aria-label={t('plan.addTask')}
      />
    </div>
  )
}

export default function Plan() {
  const [days, setDays] = useState<DayView[]>([])
  const [monthGoals, setMonthGoals] = useState<Goal[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<Task | null>(null)
  const [weekOffset, setWeekOffset] = useState(0)
  const [view, setView] = useState<'week' | 'month'>('week')
  const [monthOffset, setMonthOffset] = useState(0)
  const [monthCells, setMonthCells] = useState<MonthCell[]>([])
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [selectedTasks, setSelectedTasks] = useState<Task[]>([])
  const [selectedHabits, setSelectedHabits] = useState<{ habit: Habit; done: boolean }[]>([])
  const [selectedReview, setSelectedReview] = useState<Review | null>(null)
  const [selectedDraft, setSelectedDraft] = useState('')
  // Re-entrancy guards against rapid Enter presses on the inline "+ add
  // task" inputs creating multiple copies — refs, not state, since nothing
  // needs to re-render on this, just block a second write mid-flight.
  const addingDatesRef = useRef<Set<string>>(new Set())
  const addingSelectedRef = useRef(false)
  const { t, lang } = useLang()
  const today = todayStr()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const load = useCallback(async () => {
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7)
    const series = await activeRecurringSeries()
    const views: DayView[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const date = todayStr(d)
      const tasks = (await db.tasks.where('due').equals(date).and((x) => !x.deleted).toArray()).sort(byOrder)
      const realSeriesIds = new Set(tasks.map((x) => x.seriesId).filter(Boolean))
      const previews = series
        .filter((s) => !realSeriesIds.has(s.seriesId) && isProjectedOccurrence(s, date))
        .map((s) => s.title)
      views.push({ date, name: d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : undefined, { weekday: 'long' }), tasks, previews })
    }
    setDays(views)
    setMonthGoals(await db.goals.filter((g) => g.type === 'month' && !g.deleted).toArray())
  }, [weekOffset, lang])

  const loadMonth = useCallback(async () => {
    const base = new Date()
    base.setDate(1)
    base.setMonth(base.getMonth() + monthOffset)
    const year = base.getFullYear()
    const month = base.getMonth()
    const firstOfMonth = new Date(year, month, 1)
    const startPad = (firstOfMonth.getDay() + 6) % 7 // Monday-start grid
    const gridStart = new Date(firstOfMonth)
    gridStart.setDate(firstOfMonth.getDate() - startPad)
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const totalCells = Math.ceil((startPad + daysInMonth) / 7) * 7
    const gridEnd = new Date(gridStart)
    gridEnd.setDate(gridStart.getDate() + totalCells - 1)

    const gridStartStr = todayStr(gridStart)
    const gridEndStr = todayStr(gridEnd)

    const tasksInRange = await db.tasks
      .where('due').between(gridStartStr, gridEndStr, true, true)
      .and((x) => !x.deleted).toArray()
    const byDate = new Map<string, Task[]>()
    for (const x of tasksInRange) {
      if (!x.due) continue
      const arr = byDate.get(x.due) ?? []
      arr.push(x)
      byDate.set(x.due, arr)
    }

    // Habits: how many of the user's active habits hit their daily target,
    // per date — same "count >= target" rule habitStats() uses elsewhere.
    const activeHabits = await db.habits.where('active').equals(1).and((h) => !h.deleted).toArray()
    const logsInRange = await db.habitLogs
      .where('date').between(gridStartStr, gridEndStr, true, true)
      .and((l) => !l.deleted).toArray()
    const countByDateHabit = new Map<string, Map<string, number>>()
    for (const l of logsInRange) {
      const byHabit = countByDateHabit.get(l.date) ?? new Map<string, number>()
      byHabit.set(l.habitId, (byHabit.get(l.habitId) ?? 0) + l.count)
      countByDateHabit.set(l.date, byHabit)
    }

    // One daily review per date carries that day's mood.
    const reviewsInRange = await db.reviews
      .filter((r) => !r.deleted && r.type === 'daily' && r.periodStart >= gridStartStr && r.periodStart <= gridEndStr)
      .toArray()
    const moodByDate = new Map<string, Review['mood']>()
    for (const r of reviewsInRange) if (r.mood) moodByDate.set(r.periodStart, r.mood)

    const cells: MonthCell[] = []
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      const date = todayStr(d)
      const dayTasks = byDate.get(date) ?? []
      const byHabit = countByDateHabit.get(date)
      const habitsDone = activeHabits.filter((h) => (byHabit?.get(h.id) ?? 0) >= h.targetPerDay).length
      cells.push({
        date, inMonth: d.getMonth() === month,
        done: dayTasks.filter((x) => x.state === 'done').length, total: dayTasks.length,
        habitsDone, habitsTotal: activeHabits.length,
        mood: moodByDate.get(date),
      })
    }
    setMonthCells(cells)
  }, [monthOffset])

  const loadSelectedDay = useCallback(async () => {
    const tasks = (await db.tasks.where('due').equals(selectedDate).and((x) => !x.deleted).toArray()).sort(byOrder)
    setSelectedTasks(tasks)

    const activeHabits = await db.habits.where('active').equals(1).and((h) => !h.deleted).toArray()
    const logs = await db.habitLogs.where('date').equals(selectedDate).and((l) => !l.deleted).toArray()
    const countByHabit = new Map<string, number>()
    for (const l of logs) countByHabit.set(l.habitId, (countByHabit.get(l.habitId) ?? 0) + l.count)
    setSelectedHabits(activeHabits.map((h) => ({ habit: h, done: (countByHabit.get(h.id) ?? 0) >= h.targetPerDay })))

    const review = await db.reviews
      .filter((r) => !r.deleted && r.type === 'daily' && r.periodStart === selectedDate)
      .first()
    setSelectedReview(review ?? null)
  }, [selectedDate])

  useEffect(() => {
    load()
    loadMonth()
    loadSelectedDay()
    const reload = () => { load(); loadMonth(); loadSelectedDay() }
    window.addEventListener(CHANGED, reload)
    return () => window.removeEventListener(CHANGED, reload)
  }, [load, loadMonth, loadSelectedDay])

  async function toggle(task: Task) {
    const state: TaskState = task.state === 'done' ? 'open' : 'done'
    const updated: Task = { ...task, state, completedAt: nextCompletedAt(task.state, task.completedAt, state), updatedAt: Date.now() }
    await writeAndQueue(db.tasks, 'task', updated)
    if (updated.goalId) await rollUpGoal(updated.goalId)
    syncNow()
  }

  async function addFor(date: string) {
    const text = (drafts[date] ?? '').trim()
    if (!text || addingDatesRef.current.has(date)) return
    addingDatesRef.current.add(date)
    try {
      const count = days.find((d) => d.date === date)?.tasks.length ?? 0
      await writeAndQueue(db.tasks, 'task', {
        id: uuid(), title: text, state: 'open', priority: 3, due: date, sortOrder: count, deleted: 0, updatedAt: Date.now(),
      })
      setDrafts((d) => ({ ...d, [date]: '' }))
      await load()
      syncNow()
    } finally {
      addingDatesRef.current.delete(date)
    }
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const all = days.flatMap((d) => d.tasks)
    const moved = all.find((x) => x.id === activeId)
    if (!moved) return

    const isDateId = days.some((d) => d.date === overId)
    const overTask = all.find((x) => x.id === overId)
    const targetDate = isDateId ? overId : overTask?.due ?? moved.due
    if (!targetDate) return

    const dayIds = all.filter((x) => x.due === targetDate && x.id !== activeId).sort(byOrder).map((x) => x.id)
    let idx = dayIds.length
    if (!isDateId) {
      const oi = dayIds.indexOf(overId)
      idx = oi >= 0 ? oi : dayIds.length
    }
    const newIds = [...dayIds.slice(0, idx), activeId, ...dayIds.slice(idx)]

    const now = Date.now()
    let wrote = false
    for (let i = 0; i < newIds.length; i++) {
      const task = all.find((x) => x.id === newIds[i])!
      const dueChanged = task.id === activeId && task.due !== targetDate
      if (task.sortOrder === i && !dueChanged) continue
      const patch: Task = { ...task, sortOrder: i, updatedAt: now }
      if (task.id === activeId) patch.due = targetDate
      await writeAndQueue(db.tasks, 'task', patch)
      wrote = true
    }
    if (wrote) syncNow()
  }

  async function addForSelected() {
    const text = selectedDraft.trim()
    if (!text || addingSelectedRef.current) return
    addingSelectedRef.current = true
    try {
      await writeAndQueue(db.tasks, 'task', {
        id: uuid(), title: text, state: 'open', priority: 3, due: selectedDate, sortOrder: selectedTasks.length, deleted: 0, updatedAt: Date.now(),
      })
      setSelectedDraft('')
      syncNow()
    } finally {
      addingSelectedRef.current = false
    }
  }

  async function handleSelectedDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = selectedTasks.map((x) => x.id)
    const oldI = ids.indexOf(String(active.id))
    const newI = ids.indexOf(String(over.id))
    if (oldI < 0 || newI < 0) return
    const ordered = arrayMove(ids, oldI, newI)
    const now = Date.now()
    for (let i = 0; i < ordered.length; i++) {
      const task = selectedTasks.find((x) => x.id === ordered[i])!
      if (task.sortOrder === i) continue
      await writeAndQueue(db.tasks, 'task', { ...task, sortOrder: i, updatedAt: now })
    }
    syncNow()
  }

  const locale = lang === 'zh' ? 'zh-CN' : undefined
  const monthName = new Date().toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const weekDone = days.reduce((s, d) => s + d.tasks.filter((x) => x.state === 'done').length, 0)
  const weekTotal = days.reduce((s, d) => s + d.tasks.length, 0)
  const fmt = (s?: string) => (s ? new Date(s + 'T00:00').toLocaleDateString(locale, { month: 'short', day: 'numeric' }) : '')
  const weekRange = days.length ? `${fmt(days[0].date)} – ${fmt(days[6].date)}` : ''
  const gridMonthBase = new Date()
  gridMonthBase.setDate(1)
  gridMonthBase.setMonth(gridMonthBase.getMonth() + monthOffset)
  const gridMonthName = gridMonthBase.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const weekdayLabels = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(2024, 0, 1 + i) // Jan 1 2024 was a Monday — locale-correct short weekday names
    return d.toLocaleDateString(locale, { weekday: 'short' })
  })
  const selectedDayView: DayView = {
    date: selectedDate,
    name: new Date(selectedDate + 'T00:00').toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' }),
    tasks: selectedTasks,
    previews: [],
  }

  return (
    <div>
      <div className="greet">
        <h1>{t('plan.title')}</h1>
        <div className="sub">{t('plan.sub', { month: monthName })}</div>
      </div>

      <div className="seg view-toggle">
        <button className={`seg-btn ${view === 'week' ? 'on' : ''}`} onClick={() => setView('week')}>
          <b>{t('plan.week')}</b>
        </button>
        <button className={`seg-btn ${view === 'month' ? 'on' : ''}`} onClick={() => setView('month')}>
          <b>{t('plan.month')}</b>
        </button>
      </div>

      {view === 'week' ? (
        <>
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
        </>
      ) : (
        <>
          <div className="week-nav">
            <button className="wk-arrow" onClick={() => setMonthOffset((o) => o - 1)} aria-label="Previous month">‹</button>
            <div className="wk-mid">
              <div className="wk-rel">{relativeMonth(monthOffset, t)}</div>
              <div className="wk-range num">{gridMonthName}</div>
            </div>
            <button className="wk-arrow" onClick={() => setMonthOffset((o) => o + 1)} aria-label="Next month">›</button>
          </div>
          {monthOffset !== 0 && (
            <button className="wk-today" onClick={() => setMonthOffset(0)}>{t('plan.backToMonth')}</button>
          )}
        </>
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

      {view === 'week' ? (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
          <div className="stack week-days" style={{ marginTop: '0.6rem' }}>
            {days.map((d) => (
              <DayColumn
                key={d.date}
                day={d}
                today={today}
                draft={drafts[d.date] ?? ''}
                onDraft={(v) => setDrafts((dr) => ({ ...dr, [d.date]: v }))}
                onAdd={() => addFor(d.date)}
                onToggle={toggle}
                onEdit={setEditing}
                t={t}
              />
            ))}
          </div>
        </DndContext>
      ) : (
        <>
          <div className="month-weekday-row">
            {weekdayLabels.map((l) => <span key={l} className="month-weekday">{l}</span>)}
          </div>
          <div className="month-grid">
            {monthCells.map((c, i) => (
              <button
                key={c.date}
                type="button"
                className={`month-cell ${c.inMonth ? '' : 'out'} ${c.date === today ? 'today' : ''} ${c.date === selectedDate ? 'selected' : ''}`}
                style={{ animationDelay: `${Math.min(i * 9, 260)}ms` }}
                onClick={() => setSelectedDate(c.date)}
              >
                <span className="mc-top">
                  <span className="mc-num num">{Number(c.date.slice(8, 10))}</span>
                  {c.mood && <span className="mc-mood" aria-hidden>{MOOD_EMOJI[c.mood]}</span>}
                </span>
                {c.total > 0 && (
                  <span className="mc-taskbar">
                    <i className={c.done === c.total ? 'done' : 'partial'} style={{ width: `${(c.done / c.total) * 100}%` }} />
                  </span>
                )}
                {c.habitsTotal > 0 && (
                  <span className="mc-habits">
                    {Array.from({ length: c.habitsTotal }).map((_, i) => (
                      <span key={i} className={`hdot ${i < c.habitsDone ? 'on' : ''}`} />
                    ))}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div key={selectedDate} className="day-detail-fade">
            <div className="section-h">
              {selectedDayView.name}{selectedDate === today ? ` · ${t('common.today')}` : ''}
              {selectedReview?.mood && <span className="panel-mood" aria-hidden>{MOOD_EMOJI[selectedReview.mood]}</span>}
            </div>
            <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleSelectedDragEnd}>
              <SortableContext items={selectedTasks.map((x) => x.id)} strategy={verticalListSortingStrategy}>
                <div className="card day-card month-selected-panel">
                  {selectedTasks.map((task) => (
                    <TaskRow key={task.id} task={task} onToggle={() => toggle(task)} onEdit={() => setEditing(task)} t={t} />
                  ))}
                  <input
                    className="add-inline"
                    type="text"
                    placeholder={t('plan.addTask')}
                    value={selectedDraft}
                    onChange={(e) => setSelectedDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addForSelected()}
                    aria-label={t('plan.addTask')}
                  />
                </div>
              </SortableContext>
            </DndContext>

            {selectedHabits.length > 0 && (
              <>
                <div className="section-h">{t('today.habits')}</div>
                <div className="habit-strip">
                  {selectedHabits.map(({ habit, done }) => (
                    <span key={habit.id} className={`hchip ${done ? 'on' : ''}`}>
                      <span className="ico">{habit.emoji}</span>{habit.name}
                    </span>
                  ))}
                </div>
              </>
            )}

            {selectedReview && (selectedReview.wins || selectedReview.mood) && (
              <>
                <div className="section-h">{t('plan.dayReview')}</div>
                <div className="card review-mini">
                  {selectedReview.mood && <span className="e" aria-hidden>{MOOD_EMOJI[selectedReview.mood]}</span>}
                  {selectedReview.wins && <span className="txt">{selectedReview.wins}</span>}
                </div>
              </>
            )}
          </div>
        </>
      )}
      {editing && <TaskForm task={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
