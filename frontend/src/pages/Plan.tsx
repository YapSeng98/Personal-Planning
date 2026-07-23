import { useEffect, useState, useCallback } from 'react'
import {
  DndContext, useDroppable, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCorners, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { db, uuid, todayStr, writeAndQueue, rollUpGoal, byOrder, CHANGED, type Task, type Goal } from '../db/db'
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
        {task.title}
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
    const views: DayView[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const date = todayStr(d)
      const tasks = (await db.tasks.where('due').equals(date).and((x) => !x.deleted).toArray()).sort(byOrder)
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
      {editing && <TaskForm task={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
