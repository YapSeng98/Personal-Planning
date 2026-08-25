import { useEffect, useState, useCallback } from 'react'
import {
  DndContext, useDroppable, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCorners, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { db, uuid, todayStr, writeAndQueue, rollUpGoal, byOrder, activeRecurringSeries, isProjectedOccurrence, CHANGED, type Task, type Goal } from '../db/db'
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
}

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
  const [selectedDraft, setSelectedDraft] = useState('')
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

    const tasksInRange = await db.tasks
      .where('due').between(todayStr(gridStart), todayStr(gridEnd), true, true)
      .and((x) => !x.deleted).toArray()
    const byDate = new Map<string, Task[]>()
    for (const x of tasksInRange) {
      if (!x.due) continue
      const arr = byDate.get(x.due) ?? []
      arr.push(x)
      byDate.set(x.due, arr)
    }

    const cells: MonthCell[] = []
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(gridStart)
      d.setDate(gridStart.getDate() + i)
      const date = todayStr(d)
      const dayTasks = byDate.get(date) ?? []
      cells.push({ date, inMonth: d.getMonth() === month, done: dayTasks.filter((x) => x.state === 'done').length, total: dayTasks.length })
    }
    setMonthCells(cells)
  }, [monthOffset])

  const loadSelectedDay = useCallback(async () => {
    const tasks = (await db.tasks.where('due').equals(selectedDate).and((x) => !x.deleted).toArray()).sort(byOrder)
    setSelectedTasks(tasks)
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
    const updated: Task = { ...task, state: task.state === 'done' ? 'open' : 'done', updatedAt: Date.now() }
    await writeAndQueue(db.tasks, 'task', updated)
    if (updated.goalId) await rollUpGoal(updated.goalId)
    syncNow()
  }

  async function addFor(date: string) {
    const text = (drafts[date] ?? '').trim()
    if (!text) return
    const count = days.find((d) => d.date === date)?.tasks.length ?? 0
    await writeAndQueue(db.tasks, 'task', {
      id: uuid(), title: text, state: 'open', priority: 3, due: date, sortOrder: count, deleted: 0, updatedAt: Date.now(),
    })
    setDrafts((d) => ({ ...d, [date]: '' }))
    await load()
    syncNow()
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
    if (!text) return
    await writeAndQueue(db.tasks, 'task', {
      id: uuid(), title: text, state: 'open', priority: 3, due: selectedDate, sortOrder: selectedTasks.length, deleted: 0, updatedAt: Date.now(),
    })
    setSelectedDraft('')
    syncNow()
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
            {monthCells.map((c) => (
              <button
                key={c.date}
                type="button"
                className={`month-cell ${c.inMonth ? '' : 'out'} ${c.date === today ? 'today' : ''} ${c.date === selectedDate ? 'selected' : ''}`}
                onClick={() => setSelectedDate(c.date)}
              >
                <span className="mc-num num">{Number(c.date.slice(8, 10))}</span>
                {c.total > 0 && (
                  <span className={`mc-count num ${c.done === c.total ? 'all-done' : 'pending'}`}>{c.done}/{c.total}</span>
                )}
              </button>
            ))}
          </div>

          <div className="section-h">{selectedDayView.name}{selectedDate === today ? ` · ${t('common.today')}` : ''}</div>
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
        </>
      )}
      {editing && <TaskForm task={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
