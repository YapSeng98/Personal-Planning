import { Fragment, useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, useDroppable, MeasuringStrategy,
  closestCenter, pointerWithin, getFirstCollision,
  type CollisionDetection, type UniqueIdentifier, type DragEndEvent, type DragOverEvent, type DragMoveEvent, type DragStartEvent, type SensorDescriptor, type SensorOptions,
} from '@dnd-kit/core'
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { db, todayStr, addDays, OVERDUE_DAYS, isOpenOneOff, writeAndQueue, uuidFrom, patchAndQueue, habitStreak, rollUpGoal, cleanEmoji, byOrder, nextCompletedAt, CHANGED, type Task, type TaskState, type Habit, type Project } from '../db/db'
import { syncNow } from '../sync/engine'
import { currentUser } from '../sync/api'
import { aiEnabled, askAI } from '../lib/ai'
import { HeroVideoSlot, useVideo } from '../components/VideoPlayer'
import { projectColorVar } from '../lib/projectColors'
import Insights from '../components/Insights'
import TaskForm from '../components/TaskForm'
import HabitEdit from '../components/HabitEdit'
import Icon from '../components/Icon'
import { useLang, type TFn } from '../lib/i18n'
import { startTimer, stopTimer, useRunningTimer, useElapsed, clock, hm } from '../lib/timer'
import { spentHours, minutesByDay, stepCount } from '../lib/items'
import { moveTasksTo, fromDailyBrief, DAILY_BRIEF_URL } from '../lib/tasks'
import PlanTomorrow from '../components/PlanTomorrow'

interface HabitView extends Habit {
  doneToday: number
  streak: number
  /** Last 7 days, oldest → today: did the log reach the daily target? */
  week: boolean[]
}

function greeting(t: TFn): [string, string] {
  const h = new Date().getHours()
  if (h < 12) return [t('today.morning'), '☀️']
  if (h < 18) return [t('today.afternoon'), '🌤️']
  return [t('today.evening'), '🌙']
}

/** Today's list sinks finished work to the bottom so what's left to do stays
    at the top; within each group the manual drag order still applies. */
function byDoneThenOrder(a: Task, b: Task): number {
  const ad = a.state === 'done' ? 1 : 0
  const bd = b.state === 'done' ? 1 : 0
  if (ad !== bd) return ad - bd
  return byOrder(a, b)
}

/** Rule-based briefing (parameterized so it translates). */
function briefingText(tasks: Task[], overdue: number, t: TFn): string {
  const open = tasks.filter((x) => x.state !== 'done' && x.state !== 'cancelled')
  const done = tasks.filter((x) => x.state === 'done')
  const left = overdue ? ' ' + t('brief.overdue', { n: overdue }) : ''
  if (tasks.length === 0) return overdue ? t('brief.onlyOverdue', { n: overdue }) : t('brief.cleanSlate')
  if (open.length === 0) return t('brief.allDone', { n: done.length }) + left
  const mit = open.find((x) => x.isMit)
  // the next block that hasn't ended yet (one moved over from an earlier day
  // may keep a time that's already gone)
  const nowHM = new Date().toTimeString().slice(0, 5)
  const next = open
    .filter((x) => x.timeBlockStart && (x.timeBlockEnd ?? x.timeBlockStart).slice(11, 16) > nowHM)
    .sort((a, b) => a.timeBlockStart!.localeCompare(b.timeBlockStart!))[0]
  const parts: string[] = []
  if (done.length > 0) parts.push(t('brief.momentum', { done: done.length, left: open.length }))
  else parts.push(t('brief.planned', { n: open.length }))
  if (mit) parts.push(t('brief.mit', { title: mit.title }))
  if (next?.timeBlockStart) parts.push(t('brief.next', { time: next.timeBlockStart.slice(11, 16) }))
  return parts.join(' ') + left
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

interface Momentum {
  series: number[]
  weekDone: number
  streak: number
  /** Which habit the best-streak number belongs to — shown so the tile is never ambiguous. */
  streakHabit?: { id: string; name: string; emoji: string }
}

interface Reminder {
  task: Task
  /** Days until the task is due (0 = today, 1 = tomorrow, ...). */
  daysUntilDue: number
}

/** Start / stop timing this task. Running, it shows the live clock (its own
    component, so the once-a-second tick re-renders only the button). */
function TimerButton({ task, since, t }: { task: Task; since?: number; t: TFn }) {
  const sec = useElapsed(since)
  const running = since !== undefined
  return (
    <button
      type="button"
      className={`ttimer ${running ? 'on' : ''}`}
      onClick={() => (running ? stopTimer() : startTimer(task))}
      aria-pressed={running}
      aria-label={running ? t('timer.stopFor', { title: task.title }) : t('timer.startFor', { title: task.title })}
      title={running ? t('timer.stop') : t('timer.start')}
    >
      <Icon name={running ? 'stop' : 'play'} size={13} strokeWidth={2.2} />
      {running && <span className="num">{clock(sec)}</span>}
    </button>
  )
}

/** One tap to the priority group above / below (the "By priority" view) —
    a way to move a task that doesn't need a drag. */
interface PrioMove { up?: () => void; down?: () => void; upLabel?: string; downLabel?: string }

function TodayCard({ task, proj, timingSince, dropHint, prioMove, onToggle, onEdit, t }: {
  task: Task; proj?: Project; timingSince?: number
  /** a card dragged from another group would land above / below this one */
  dropHint?: 'above' | 'below'
  prioMove?: PrioMove
  onToggle: () => void; onEdit: () => void; t: TFn
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  const done = task.state === 'done'
  const spent = spentHours(task)
  const steps = stepCount(task.checklist)
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`tcard ${timingSince !== undefined ? 'timing' : ''} ${dropHint ? `drop-${dropHint}` : ''}`}
    >
      <span className="acc" style={{ background: done ? 'var(--ok)' : accentFor(task.priority) }} />
      <button className="drag-grip" aria-label="Drag to reorder" {...listeners} {...attributes}>⠿</button>
      <button className={`check ${done ? 'on' : ''}`} onClick={onToggle} aria-label={task.title}>✓</button>
      <button className="tbody" onClick={onEdit} title={task.title}>
        <div className={`ttitle ${done ? 'done' : ''}`}>{task.title}</div>
        {(Boolean(task.isMit) || task.recurrence || proj || task.notes || spent > 0 || task.estimatedHours || steps.all > 0) && (
          <div className="tmeta">
            {Boolean(task.isMit) && <span className="tstar">⭐</span>}
            {task.recurrence && <span className="trecur" title={t('task.repeat')}>🔁</span>}
            {steps.all > 0 && (
              <span className={`tsteps num ${steps.done === steps.all ? 'all' : ''}`} title={t('step.title')}>
                <Icon name="check" size={11} strokeWidth={2.6} />{steps.done}/{steps.all}
              </span>
            )}
            {fromDailyBrief(task)
              ? <span className="tbrief" title={t('brief.badgeTitle')}>📋 {t('brief.badge')}</span>
              : task.notes && <span className="tnote" title={t('task.notes')}>📝</span>}
            {(spent > 0 || !!task.estimatedHours) && (
              <span className={`tspent num ${task.estimatedHours && spent > task.estimatedHours ? 'over' : ''}`} title={t('timer.spentTitle')}>
                ⏱ {spent > 0 ? hm(spent) : '0m'}{task.estimatedHours ? ` / ${hm(task.estimatedHours)}` : ''}
              </span>
            )}
            {proj && (
              <span className="tchip" style={{ background: 'var(--accent-wash)', color: 'var(--text-2)' }}>
                <span className="cd" style={{ background: projectColorVar(proj.color) }} />
                {proj.title}
              </span>
            )}
          </div>
        )}
      </button>
      {prioMove && (
        <span className="prio-move">
          <button type="button" className={prioMove.up ? '' : 'none'} onClick={prioMove.up} disabled={!prioMove.up}
            aria-label={prioMove.upLabel} title={prioMove.upLabel}>▲</button>
          <button type="button" className={prioMove.down ? '' : 'none'} onClick={prioMove.down} disabled={!prioMove.down}
            aria-label={prioMove.downLabel} title={prioMove.downLabel}>▼</button>
        </span>
      )}
      {!done && <TimerButton task={task} since={timingSince} t={t} />}
      <span className={`ttime ${task.timeBlockStart ? '' : 'faint'}`}>
        {task.timeBlockStart
          ? <>{task.timeBlockStart.slice(11, 16)}{task.timeBlockEnd && <span className="tend">–{task.timeBlockEnd.slice(11, 16)}</span>}</>
          : t('today.anytime')}
      </span>
    </div>
  )
}

/** Priority groups for the "By priority" view, matching the card colours
    (1–2 high, 3 medium, 4–5 low). Dropping a task in a group gives it that
    group's priority (what the task form sets). */
type Level = 'high' | 'med' | 'low'
const LEVELS: { key: Level; value: number; label: string; color: string }[] = [
  { key: 'high', value: 1, label: 'task.prioHigh', color: 'var(--accent)' },
  { key: 'med', value: 3, label: 'task.prioMed', color: 'var(--amber)' },
  { key: 'low', value: 5, label: 'task.prioLow', color: 'var(--ok)' },
]
const levelOf = (p: number): Level => (p <= 2 ? 'high' : p === 3 ? 'med' : 'low')
type Groups = Record<Level, string[]>

/** A whole group (header included) takes a drop — the empty ones too. */
function GroupDrop({ level, empty, target, children }: { level: Level; empty: boolean; target: boolean; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id: `group:${level}` })
  return <section ref={setNodeRef} className={`pgroup pgroup-${level} ${empty ? 'is-empty' : ''} ${target ? 'over' : ''}`}>{children}</section>
}

/** Where a dragged card would land in another group. */
interface DropHint { level: Level; id?: string; below?: boolean }

/** Today's tasks under High / Medium / Low (an empty group shows as a slim
    "drag one here" row). Drag within a group to reorder (the cards make
    room as you go), into another group to change the task's priority: the
    lists stay still while you drag between groups —
    the group lights up and a line shows where the card will land — and it
    moves when you let go. (Moving it between stacked groups mid-drag slid
    the groups below under the finger and carried the card on past where it
    was aimed.) */
function PriorityList({ tasks, sensors, renderCard, onCommit, t }: {
  tasks: Task[]
  sensors: SensorDescriptor<SensorOptions>[]
  renderCard: (task: Task, hint?: 'above' | 'below', move?: PrioMove) => React.ReactNode
  onCommit: (groups: Groups, moved: string, to: Level | null) => void
  t: TFn
}) {
  const build = useCallback((): Groups => {
    const g: Groups = { high: [], med: [], low: [] }
    for (const x of [...tasks].sort(byDoneThenOrder)) g[levelOf(x.priority)].push(x.id)
    return g
  }, [tasks])
  const [groups, setGroups] = useState<Groups>(build)
  const [active, setActive] = useState<string | null>(null)
  const [hint, setHint] = useState<DropHint | null>(null)
  // follow changes (a sync, a tick) — but never mid-drag
  useEffect(() => { if (!active) setGroups(build()) }, [build, active])
  const byId = new Map(tasks.map((x) => [x.id, x]))
  const isGroup = (id: UniqueIdentifier) => String(id).startsWith('group:')
  const find = (id: UniqueIdentifier): Level | undefined =>
    isGroup(id) ? (String(id).slice(6) as Level) : LEVELS.find((l) => groups[l.key].includes(String(id)))?.key

  // The group under the finger decides where it goes. In the card's own
  // group: the nearest card, as in the one-list view (the cards make room);
  // in another group: that group's nearest card, or the group if it's empty.
  const lastGroup = useRef<Level | null>(null)
  const collision: CollisionDetection = useCallback((args) => {
    const groupHits = pointerWithin({ ...args, droppableContainers: args.droppableContainers.filter((c) => isGroup(c.id)) })
    const hit = getFirstCollision(groupHits, 'id')
    if (hit != null) lastGroup.current = String(hit).slice(6) as Level
    const level = lastGroup.current
    if (!level) return []
    const ids = groups[level]
    if (!ids.length) return [{ id: `group:${level}` }]
    return closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => ids.includes(String(c.id))) })
  }, [groups])

  /** The landing spot in another group, or null within the same group. */
  function target(a: DragOverEvent['active'], over: DragOverEvent['over']): DropHint | null {
    if (!over) return null
    const from = find(a.id), to = find(over.id)
    if (!from || !to || from === to) return null
    if (isGroup(over.id)) return { level: to }
    const r = a.rect.current.translated
    const below = !!r && r.top + r.height / 2 > over.rect.top + over.rect.height / 2
    return { level: to, id: String(over.id), below }
  }

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id)
    lastGroup.current = LEVELS.find((l) => groups[l.key].includes(id))?.key ?? null
    setActive(id)
  }
  function onDragOver({ active: a, over }: DragOverEvent) {
    const h = target(a, over)
    setHint((cur) => (cur?.level === h?.level && cur?.id === h?.id && cur?.below === h?.below ? cur : h))
  }
  function onDragMove({ active: a, over }: DragMoveEvent) { onDragOver({ active: a, over } as DragOverEvent) }
  function onDragEnd({ active: a, over }: DragEndEvent) {
    const id = String(a.id), from = find(id)
    const h = target(a, over)
    let next = groups
    if (from && h) {
      // into another group, at the spot the line showed
      const dst = groups[h.level].filter((x) => x !== id)
      const i = h.id ? dst.indexOf(h.id) : -1
      dst.splice(i < 0 ? dst.length : i + (h.below ? 1 : 0), 0, id)
      next = { ...groups, [from]: groups[from].filter((x) => x !== id), [h.level]: dst }
    } else if (from && over && find(over.id) === from && !isGroup(over.id)) {
      const list = groups[from], oldI = list.indexOf(id), newI = list.indexOf(String(over.id))
      if (oldI >= 0 && newI >= 0 && oldI !== newI) next = { ...groups, [from]: arrayMove(list, oldI, newI) }
    }
    setGroups(next)
    setActive(null)
    setHint(null)
    if (next !== groups) onCommit(next, id, h?.level ?? from ?? null)
  }
  const dragged = active ? byId.get(active) : undefined

  /** ▲ / ▼: to the group above / below, after its open tasks. */
  function shift(id: string, dir: -1 | 1) {
    const from = find(id)
    const to = from ? LEVELS[LEVELS.findIndex((l) => l.key === from) + dir]?.key : undefined
    if (!from || !to) return
    const dst = [...groups[to]]
    const at = byId.get(id)?.state === 'done' ? -1 : dst.findIndex((x) => byId.get(x)?.state === 'done')
    dst.splice(at < 0 ? dst.length : at, 0, id)
    const next = { ...groups, [from]: groups[from].filter((x) => x !== id), [to]: dst }
    setGroups(next)
    onCommit(next, id, to)
  }
  const moveFor = (level: Level, id: string): PrioMove => {
    const i = LEVELS.findIndex((l) => l.key === level)
    const above = LEVELS[i - 1], below = LEVELS[i + 1]
    return {
      up: above ? () => shift(id, -1) : undefined,
      down: below ? () => shift(id, 1) : undefined,
      upLabel: above ? t('prio.moveTo', { level: t(above.label) }) : undefined,
      downLabel: below ? t('prio.moveTo', { level: t(below.label) }) : undefined,
    }
  }

  return (
    // near the screen's edge the page scrolls — gently, so a drop aimed at
    // the bottom group doesn't race past it
    // Positions are measured once, as the drag starts: measured again mid-drag
    // they'd include the cards sliding aside, and the dragged card would seem
    // to be under the finger — a drop then kept the old order. (So nothing
    // may appear mid-drag: empty groups are always shown.)
    <DndContext sensors={sensors} collisionDetection={collision} autoScroll={{ threshold: { x: 0, y: 0.1 }, acceleration: 4 }}
      measuring={{ droppable: { strategy: MeasuringStrategy.BeforeDragging } }}
      onDragStart={onDragStart} onDragOver={onDragOver} onDragMove={onDragMove} onDragEnd={onDragEnd}
      onDragCancel={() => { setActive(null); setHint(null); setGroups(build()) }}>
      {LEVELS.map((l) => {
        const list = groups[l.key]
        return (
          <GroupDrop key={l.key} level={l.key} empty={!list.length} target={hint?.level === l.key}>
            <div className="pgroup-h"><i style={{ background: l.color }} aria-hidden />{t(l.label)}<b className="num">{list.length}</b></div>
            <SortableContext id={l.key} items={list} strategy={verticalListSortingStrategy}>
              <div className="tstack">
                {list.map((id) => byId.get(id) && (
                  <Fragment key={id}>{renderCard(byId.get(id)!, hint?.id === id ? (hint.below ? 'below' : 'above') : undefined, moveFor(l.key, id))}</Fragment>
                ))}
                {!list.length && <div className="pgroup-empty">{t('prio.empty', { level: t(l.label).toLowerCase() })}</div>}
              </div>
            </SortableContext>
          </GroupDrop>
        )
      })}
      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div className="tcard drag-ghost">
            <span className="acc" style={{ background: dragged.state === 'done' ? 'var(--ok)' : accentFor(dragged.priority) }} />
            <span className="drag-grip" aria-hidden>⠿</span>
            <div className={`ttitle ${dragged.state === 'done' ? 'done' : ''}`}>{dragged.title}</div>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  )
}

/** Live HH:MM:SS readout for the hero HUD. Its own component so the
    once-a-second tick re-renders only this, not the whole Today page. */
function HudClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return <span className="hud-clock num">{now.toTimeString().slice(0, 8)}</span>
}

/** Types the briefing out a few characters at a time, like a terminal.
    Reduced-motion users get the full text at once. */
function Typewriter({ text }: { text: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(text.length); return }
    setN(0)
    const step = Math.max(1, Math.ceil(text.length / 90))
    const id = window.setInterval(() => {
      setN((c) => {
        if (c + step >= text.length) { window.clearInterval(id); return text.length }
        return c + step
      })
    }, 18)
    return () => window.clearInterval(id)
  }, [text])
  const typing = n < text.length
  return (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden>{text.slice(0, n)}<span className={`tw-caret ${typing ? 'on' : ''}`} /></span>
    </>
  )
}

// Fanned out on one arc around the button (radius 106px, 80° → 210°, 26°
// apart): the 44px bubbles never touch, the first stays inside the right
// edge of a phone screen and the last clears the + button.
const QUICK_APPS = [
  { href: 'https://yapseng98.github.io/personal_business/#/', icon: '💼', color: 'var(--project-blue)', tx: '18px', ty: '-104px', labelKey: 'today.bizLink' as const },
  { href: 'https://yapseng98.github.io/Personal-Money-Tracker/', icon: '💰', color: 'var(--project-teal)', tx: '-29px', ty: '-102px', labelKey: 'today.moneyLink' as const },
  { href: 'https://yapseng98.github.io/Love-Points-Tracker/?fresh=1785915091776', icon: '🎮', color: 'var(--project-purple)', tx: '-71px', ty: '-79px', labelKey: 'today.gameLink' as const },
  { href: 'https://yapseng98.github.io/Knowledge_Management_System/', icon: '📚', color: 'var(--ok)', tx: '-98px', ty: '-40px', labelKey: 'today.kmsLink' as const },
  { href: 'https://yapseng98.github.io/trading_pages/report.html', icon: '📈', color: 'var(--amber)', tx: '-106px', ty: '7px', labelKey: 'today.tradingLink' as const },
  { href: DAILY_BRIEF_URL, icon: '📋', color: 'var(--accent)', tx: '-92px', ty: '53px', labelKey: 'today.briefLink' as const },
]

function QuickLaunch({ t }: { t: TFn }) {
  const [open, setOpen] = useState(false)
  const [hovering, setHovering] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number | null>(null)
  const visible = open || hovering

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  // Fanned-out satellites sit visually far from the 52px trigger with empty
  // page between them — a plain CSS :hover drops the instant the mouse
  // crosses that gap on the way to one, closing the menu before it's
  // reachable. A short close-delay (cancelled if the pointer lands back
  // inside, e.g. on a satellite) gives a normal mouse move enough time to
  // cross that gap without the menu disappearing underneath it.
  const onEnter = () => { cancelClose(); setHovering(true) }
  const onLeave = () => { closeTimer.current = window.setTimeout(() => setHovering(false), 260) }

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setHovering(false)
        cancelClose()
      }
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => () => cancelClose(), [])

  return (
    <div className={`ql-orbit ${visible ? 'open' : ''}`} ref={ref} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        type="button"
        className="ql-fab"
        aria-haspopup="true"
        aria-expanded={visible}
        aria-label={t('today.quickApps')}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ql-fab-grid" aria-hidden>
          {Array.from({ length: 9 }).map((_, i) => <span key={i} />)}
        </span>
      </button>
      {QUICK_APPS.map((a) => (
        <a
          key={a.href}
          href={a.href}
          target="_blank"
          rel="noopener noreferrer"
          className="ql-sat"
          style={{ ['--ql-accent' as string]: a.color, ['--tx' as string]: a.tx, ['--ty' as string]: a.ty }}
          onClick={() => { setOpen(false); setHovering(false); cancelClose() }}
          aria-label={t(a.labelKey)}
        >
          <span aria-hidden>{a.icon}</span>
          <span className="ql-tip">{t(a.labelKey)}</span>
        </a>
      ))}
    </div>
  )
}

export default function Today() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [overdue, setOverdue] = useState<Task[]>([])
  const [showAllOverdue, setShowAllOverdue] = useState(false)
  const [tomorrowCount, setTomorrowCount] = useState(0)
  const [planning, setPlanning] = useState(false)
  const [view, setView] = useState<'order' | 'priority'>(() => (localStorage.getItem('planner_today_view') === 'priority' ? 'priority' : 'order'))
  const pickView = (v: 'order' | 'priority') => { localStorage.setItem('planner_today_view', v); setView(v) }
  const [wrapHidden, setWrapHidden] = useState(() => localStorage.getItem('planner_wrap_hidden') === todayStr())
  const timer = useRunningTimer()
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [habits, setHabits] = useState<HabitView[]>([])
  const [projects, setProjects] = useState<Record<string, Project>>({})
  const [mom, setMom] = useState<Momentum>({ series: [0, 0, 0, 0, 0, 0, 0], weekDone: 0, streak: 0 })
  const [editing, setEditing] = useState<Task | null>(null)
  const [editingHabit, setEditingHabit] = useState<Habit | 'new' | null>(null)
  const { videoId, nowPlaying } = useVideo()
  const [aiBrief, setAiBrief] = useState<string | null>(null)
  const [briefState, setBriefState] = useState<'idle' | 'loading' | 'err'>('idle')
  const briefAuto = useRef(false)
  const { t, lang } = useLang()
  const navigate = useNavigate()
  const today = todayStr()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const load = useCallback(async () => {
    const rows = (await db.tasks.where('due').equals(today).and((x) => !x.deleted).toArray()).sort(byDoneThenOrder)
    setTasks(rows)
    // most recently missed first
    const late = await db.tasks.where('due').between(addDays(today, -OVERDUE_DAYS), today, true, false).and(isOpenOneOff).toArray()
    setOverdue(late.sort((a, b) => b.due!.localeCompare(a.due!) || byOrder(a, b)))
    setTomorrowCount(await db.tasks.where('due').equals(addDays(today, 1)).and((x) => !x.deleted).count())

    // Reminders: any open task whose reminderDaysBefore matches exactly how
    // many days away its due date is — this is why it can surface tasks due
    // a few days out, which wouldn't otherwise show up anywhere on Today.
    // Reminders go at most 3 days ahead (TaskForm), so only that range of
    // due dates is read, not every task ever made.
    const todayMs = new Date(today + 'T00:00').getTime()
    const withReminder = await db.tasks
      .where('due').between(today, addDays(today, 3), true, true)
      .and((x) => !x.deleted && x.state !== 'done' && x.state !== 'cancelled' && x.reminderDaysBefore != null)
      .toArray()
    const active: Reminder[] = withReminder
      .map((task) => ({ task, daysUntilDue: Math.round((new Date(task.due! + 'T00:00').getTime() - todayMs) / 86400_000) }))
      .filter(({ task, daysUntilDue }) => daysUntilDue === task.reminderDaysBefore)
    active.sort((a, b) => a.daysUntilDue - b.daysUntilDue)
    setReminders(active)

    const projRows = await db.projects.filter((p) => !p.deleted).toArray()
    setProjects(Object.fromEntries(projRows.map((p) => [p.id, p])))

    const hs = await db.habits.where('active').equals(1).and((x) => !x.deleted).toArray()
    const weekDates = Array.from({ length: 7 }, (_, i) => todayStr(new Date(Date.now() - (6 - i) * 86400_000)))
    const views: HabitView[] = []
    for (const h of hs) {
      const logs = await db.habitLogs
        .where('[habitId+date]').between([h.id, weekDates[0]], [h.id, today], true, true)
        .and((l) => !l.deleted).toArray()
      const byDate = new Map(logs.map((l) => [l.date, l.count]))
      views.push({
        ...h,
        doneToday: byDate.get(today) ?? 0,
        streak: await habitStreak(h.id),
        week: weekDates.map((d) => (byDate.get(d) ?? 0) >= h.targetPerDay),
      })
    }
    setHabits(views)

    // momentum: last 7 days of completed tasks (one read for the week) + best active streak
    const doneByDate = new Map<string, number>()
    for (const x of await db.tasks.where('due').between(weekDates[0], today, true, true).and((x) => x.state === 'done' && !x.deleted).toArray()) {
      doneByDate.set(x.due!, (doneByDate.get(x.due!) ?? 0) + 1)
    }
    const series = weekDates.map((d) => doneByDate.get(d) ?? 0)
    // Reuse the per-habit streaks already computed into `views` above instead
    // of recomputing habitStreak() a second time per habit.
    let best = 0
    let bestHabit: HabitView | null = null
    for (const v of views) {
      if (v.streak > best) { best = v.streak; bestHabit = v }
    }
    setMom({
      series,
      weekDone: series.reduce((s, n) => s + n, 0),
      streak: best,
      streakHabit: bestHabit ? { id: bestHabit.id, name: bestHabit.name, emoji: bestHabit.emoji } : undefined,
    })
  }, [today])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  // AI daily briefing — cached per day; reads its own fresh data so it doesn't
  // re-run on every task toggle. Silently falls back to the rule-based text.
  const generateBrief = useCallback(async (force = false) => {
    if (!aiEnabled()) return
    const cacheKey = `planner_brief_${today}`
    if (!force) {
      const cached = localStorage.getItem(cacheKey)
      if (cached) { setAiBrief(cached); return }
    }
    setBriefState('loading')
    try {
      const rows = await db.tasks.where('due').equals(today).and((x) => !x.deleted).toArray()
      const open = rows.filter((x) => x.state !== 'done' && x.state !== 'cancelled')
      const done = rows.filter((x) => x.state === 'done')
      const mit = open.find((x) => x.isMit)
      const list = rows
        .map((x) => `- ${x.title}${x.timeBlockStart ? ` @ ${x.timeBlockStart.slice(11, 16)}` : ''}${x.isMit ? ' [most important]' : ''} (${x.state})`)
        .join('\n')
      const hs = await db.habits.where('active').equals(1).and((x) => !x.deleted).toArray()
      const late = await db.tasks.where('due').between(addDays(today, -OVERDUE_DAYS), today, true, false).and(isOpenOneOff).toArray()
      const dateLabel = new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      const prompt = `Today is ${dateLabel}.\nMy tasks:\n${list || '(nothing planned yet)'}\nProgress: ${done.length} done, ${open.length} to go.${mit ? `\nMy most important task: "${mit.title}".` : ''}${late.length ? `\nLeft over from earlier days (overdue): ${late.slice(0, 8).map((x) => `"${x.title}"`).join(', ')}${late.length > 8 ? ` and ${late.length - 8} more` : ''}.` : ''}\nHabits I track: ${hs.map((h) => h.name).join(', ') || '(none)'}.\nWrite my briefing for today.`
      const system = lang === 'zh'
        ? '你是用户简洁、温暖的每日规划教练。用2-3个短句：肯定进展，指出当下最重要的事，并给一个可执行的小建议。不要列表、不要标题、最多一个表情。直接用“你”称呼。不要输出任何思考过程或前言，直接给出最终的简报文字。用中文回复。'
        : "You are the user's concise, warm daily planning coach. In 2-3 short sentences: acknowledge progress, point at what matters most right now, and give one practical nudge. No lists, no headings, at most one emoji. Speak directly to 'you'. Do not include any reasoning or preamble — output only the final briefing text."
      const text = await askAI(prompt, system)
      setAiBrief(text)
      localStorage.setItem(cacheKey, text)
      setBriefState('idle')
    } catch {
      setBriefState('err')
    }
  }, [today, lang])

  useEffect(() => {
    if (!aiEnabled()) return
    const cached = localStorage.getItem(`planner_brief_${today}`)
    if (cached) { setAiBrief(cached); return }
    if (briefAuto.current) return
    briefAuto.current = true
    generateBrief()
  }, [today, generateBrief])

  async function toggleTask(t: Task) {
    const state: TaskState = t.state === 'done' ? 'open' : 'done'
    // finishing the task you're timing stops the clock (and saves the time)
    if (state === 'done' && timer?.taskId === t.id) await stopTimer()
    const saved = await patchAndQueue(db.tasks, 'task', t.id, { state, completedAt: nextCompletedAt(t.state, t.completedAt, state) })
    if (saved?.goalId) await rollUpGoal(saved.goalId)
    syncNow()
  }

  /** Bring tasks from earlier days onto today (keeping their time of day),
      after today's list. */
  const moveToToday = (list: Task[]) => moveTasksTo(list, today)

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const ids = tasks.map((x) => x.id)
    const oldI = ids.indexOf(String(active.id))
    const newI = ids.indexOf(String(over.id))
    if (oldI < 0 || newI < 0) return
    const ordered = arrayMove(ids, oldI, newI)
    for (let i = 0; i < ordered.length; i++) {
      const task = tasks.find((x) => x.id === ordered[i])!
      if (task.sortOrder === i) continue
      await patchAndQueue(db.tasks, 'task', task.id, { sortOrder: i })
    }
    syncNow()
  }

  /** A drop in the priority view: the moved task takes its group's
      priority, and the day's order becomes High, then Medium, then Low. */
  async function commitPriority(groups: Groups, moved: string, to: Level | null) {
    const task = tasks.find((x) => x.id === moved)
    if (task && to && levelOf(task.priority) !== to) {
      await patchAndQueue(db.tasks, 'task', moved, { priority: LEVELS.find((l) => l.key === to)!.value })
    }
    const order = [...groups.high, ...groups.med, ...groups.low]
    for (let i = 0; i < order.length; i++) {
      const x = tasks.find((y) => y.id === order[i])
      if (x && x.sortOrder !== i) await patchAndQueue(db.tasks, 'task', x.id, { sortOrder: i })
    }
    syncNow()
  }

  async function tickHabit(h: HabitView) {
    const existing = await db.habitLogs.where('[habitId+date]').equals([h.id, today]).first()
    if (existing) {
      await patchAndQueue(db.habitLogs, 'habit_log', existing.id, { count: existing.count >= h.targetPerDay ? 0 : existing.count + 1 })
    } else {
      // Same id on every device for this habit + day (uuidFrom), so a first
      // check-in on two devices updates one log instead of creating two.
      await writeAndQueue(db.habitLogs, 'habit_log', { id: await uuidFrom(`log:${h.id}:${today}`), habitId: h.id, date: today, count: 1, deleted: 0, updatedAt: Date.now() })
    }
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
  // time focused today: sessions dated today, on today's tasks and the
  // overdue ones (time from before sessions were kept counts on its due day)
  const focusedMin = [...tasks, ...overdue].reduce((n, x) => n + (minutesByDay(x).get(today) ?? 0), 0)
  const focused = focusedMin / 60
  // the evening: wrap up — what's still open, and is tomorrow planned?
  const openToday = tasks.filter((x) => x.state === 'open' || x.state === 'in_progress')
  const evening = new Date().getHours() >= 17
  const showWrap = evening && !wrapHidden && (openToday.length > 0 || overdue.length > 0 || tomorrowCount === 0)
  const hideWrap = () => { localStorage.setItem('planner_wrap_hidden', today); setWrapHidden(true) }
  const ago = (due: string) => {
    const n = Math.round((new Date(today + 'T00:00').getTime() - new Date(due + 'T00:00').getTime()) / 86400_000)
    return n === 1 ? t('today.yesterday') : t('today.daysAgo', { n })
  }
  const card = (task: Task, dropHint?: 'above' | 'below', prioMove?: PrioMove) => (
    <TodayCard
      task={task}
      dropHint={dropHint}
      prioMove={prioMove}
      proj={task.projectId ? projects[task.projectId] : undefined}
      timingSince={timer?.taskId === task.id ? timer.startedAt : undefined}
      onToggle={() => toggleTask(task)}
      onEdit={() => setEditing(task)}
      t={t}
    />
  )
  const OVERDUE_SHOWN = 5
  const overdueShown = showAllOverdue ? overdue : overdue.slice(0, OVERDUE_SHOWN)
  const pct = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0
  const spark = areaPath(mom.series)

  return (
    <div className="today-grid">
    <div className="ga-hero">
      {/* ---- sunrise hero ---- */}
      <div className={`hero-card ${tasks.length > 0 ? 'has-ring' : ''} ${videoId || nowPlaying ? 'has-video' : ''}`}>
        <div className="hero-grid" aria-hidden />
        <div className="hero-scan" aria-hidden />
        <i className="hud-c tl" aria-hidden /><i className="hud-c tr" aria-hidden />
        <i className="hud-c bl" aria-hidden /><i className="hud-c br" aria-hidden />
        <div className="hero-wm">
          <span className="hud-dot" aria-hidden />{t('today.online')} · {t('brand')} · <HudClock />
        </div>
        <div className="hero-hi">{hello}{name ? `, ${name}` : ''} {emoji}</div>
        <div className="hero-dt">{dateLabel}</div>
        <HeroVideoSlot />
        <div className="hero-brief">
          <div className="bl">
            ✦ {aiBrief ? t('today.aiBriefing') : t('today.briefing')}
            {aiEnabled() && (
              <button
                className="brief-refresh"
                onClick={() => generateBrief(true)}
                disabled={briefState === 'loading'}
                aria-label={t('today.refresh')}
                title={t('today.refresh')}
              >
                {briefState === 'loading' ? '…' : '↻'}
              </button>
            )}
          </div>
          <div className="bt"><Typewriter text={aiBrief ?? briefingText(tasks, overdue.length, t)} /></div>
        </div>
        {tasks.length > 0 && (
          <div className="hero-ring" style={{ ['--p' as string]: pct }} aria-label={`${pct}% of today done`}>
            <span className="hero-orbit" aria-hidden />
            <i>{pct}%</i>
          </div>
        )}
      </div>

      <div className="hero-toprow">
        {reminders.length > 0 && (
          <div className="card reminder-banner">
            <div className="lbl"><span className="reminder-bell">🔔</span> {t('today.reminders')}</div>
            {reminders.map(({ task, daysUntilDue }, i) => (
              <button
                key={task.id}
                type="button"
                className="reminder-row"
                style={{ animationDelay: `${i * 70}ms` }}
                onClick={() => setEditing(task)}
              >
                <span className="reminder-title">{task.title}</span>
                <span className={`reminder-tag ${daysUntilDue === 0 ? 'due-today' : 'due-tomorrow'}`}>
                  {daysUntilDue === 0 ? t('today.dueToday') : daysUntilDue === 1 ? t('today.dueTomorrow') : t('today.dueInDays', { n: daysUntilDue })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>

    {/* Habit tiles — tap the ring to log; seven lights show the last 7
        days (today last, blinking until done). One full-width row: tiles
        share the width and shrink, never wrap or scroll. */}
    <div className="ga-habits">
      <div className="section-h">{t('today.habits')}</div>
      <div className="hx-row">
        {habits.map((h, i) => {
          const hp = Math.min(100, (h.doneToday / h.targetPerDay) * 100)
          const done = h.doneToday >= h.targetPerDay
          return (
            <div key={h.id} className={`hx ${done ? 'done' : ''}`} style={{ ['--i' as string]: i }}>
              <button
                className="hx-ring"
                style={{ ['--p' as string]: hp }}
                onClick={() => tickHabit(h)}
                aria-label={`${h.name}: ${h.doneToday} of ${h.targetPerDay} today. Tap to log.`}
              >
                <span>{cleanEmoji(h.emoji, h.name)}</span>
              </button>
              <button className="hx-name" onClick={() => navigate(`/habits/${h.id}`)} title={t('habit.viewDetail')}>
                {h.name}
              </button>
              <div className="hx-week" aria-label={`${h.week.filter(Boolean).length} of the last 7 days`}>
                {h.week.map((on, d) => (
                  <i key={d} className={`${on ? 'on' : ''} ${d === 6 ? 'today' : ''}`} />
                ))}
              </div>
              <div className="hx-meta num">
                <span>🔥 <b>{h.streak}</b></span>
                <span className="cnt">{h.doneToday}/{h.targetPerDay}</span>
              </div>
            </div>
          )
        })}
        <button className="hx hx-add" style={{ ['--i' as string]: habits.length }} onClick={() => setEditingHabit('new')} aria-label="Add a habit">
          <span className="plus" aria-hidden />
          <span className="hx-add-l">{habits.length === 0 ? t('today.addFirstHabit') : t('today.newHabit')}</span>
        </button>
      </div>
    </div>

    <div className="ga-side">
      <div className="section-h">{t('today.overview')}</div>
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
            <path className="spark-line" pathLength={1} d={spark.line} fill="none" stroke="var(--accent-bright)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle className="spark-ping" cx={spark.last[0]} cy={spark.last[1]} r="3.4" fill="none" stroke="var(--amber)" strokeWidth="1.5" />
            <circle cx={spark.last[0]} cy={spark.last[1]} r="3.4" fill="var(--amber)" stroke="var(--surface)" strokeWidth="2" />
          </svg>
        </div>
        {mom.streakHabit ? (
          <button className="m-card m-streak m-streak-btn" onClick={() => navigate(`/habits/${mom.streakHabit!.id}`)}>
            <div className="m-streak-who">{cleanEmoji(mom.streakHabit.emoji, mom.streakHabit.name)} {mom.streakHabit.name}</div>
            <div className="big num">{mom.streak}</div>
            <div className="sl">{t(mom.streak === 1 ? 'ins.day' : 'ins.days')} 🔥</div>
          </button>
        ) : (
          <div className="m-card m-streak">
            <div className="big num">{mom.streak}</div>
            <div className="sl">{t(mom.streak === 1 ? 'ins.day' : 'ins.days')} 🔥</div>
          </div>
        )}
      </div>

      <Insights />

    </div>

    <div className="ga-tasks">
      <div className="section-h">
        {t('today.tasks')}
        {(tasks.length > 0 || focused > 0) && (
          <span className="sec-sum num">
            {t('today.doneOf', { done: doneCount, n: tasks.length })}
            {focused > 0 && <> · ⏱ {t('today.focused', { time: hm(focused) })}</>}
          </span>
        )}
      </div>
      {showWrap && (
        <div className="card wrap-card" role="region" aria-label={t('ptm.wrapTitle')}>
          <span className="wrap-moon" aria-hidden>🌙</span>
          <div className="wrap-text">
            <b>{t('ptm.wrapTitle')}</b>
            <span>
              {[
                openToday.length + overdue.length > 0 ? t('ptm.wrapOpen', { n: openToday.length + overdue.length }) : t('ptm.wrapAllDone'),
                tomorrowCount === 0 ? t('ptm.wrapNothing') : t('ptm.wrapPlanned', { n: tomorrowCount }),
              ].join(' · ')}
            </span>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => setPlanning(true)}>{t('ptm.title')}</button>
          <button type="button" className="wrap-x" onClick={hideWrap} aria-label={t('ptm.wrapHide')}><Icon name="close" size={14} /></button>
        </div>
      )}
      {overdue.length > 0 && (
        <div className="card overdue-card" role="region" aria-label={t('today.overdue')}>
          <div className="overdue-h">
            <span className="overdue-lbl">{t('today.overdue')} <b className="num">{overdue.length}</b></span>
            <button type="button" className="btn overdue-all" onClick={() => moveToToday(overdue)}>
              {t(overdue.length === 1 ? 'today.moveOneToday' : 'today.moveAllToday', { n: overdue.length })}
            </button>
          </div>
          {overdueShown.map((task) => (
            <div key={task.id} className="overdue-row">
              <button className="check" onClick={() => toggleTask(task)} aria-label={t('today.markDone', { title: task.title })}>✓</button>
              <button type="button" className="overdue-title" onClick={() => setEditing(task)} title={task.title}>{task.title}</button>
              <span className="overdue-age">{ago(task.due!)}</span>
              <button type="button" className="overdue-move" onClick={() => moveToToday([task])} aria-label={t('today.moveTodayFor', { title: task.title })}>
                {t('today.moveToday')}
              </button>
            </div>
          ))}
          {overdue.length > OVERDUE_SHOWN && (
            <button type="button" className="clear-link overdue-more" onClick={() => setShowAllOverdue((v) => !v)}>
              {showAllOverdue ? t('today.showLess') : t('today.showMore', { n: overdue.length - OVERDUE_SHOWN })}
            </button>
          )}
        </div>
      )}
      {tasks.length === 0 ? (
        <div className="card empty-cta">
          <p>{t('today.emptyTasks')}</p>
          <button className="btn btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('planner:quickadd'))}>
            {t('today.addFirstTask')}
          </button>
        </div>
      ) : (
        <>
          {tasks.length > 1 && (
            <div className="task-tools">
              {view === 'priority' && <span className="task-tools-hint">{t('prio.hint')}</span>}
              <div className="view-seg" role="radiogroup" aria-label={t('prio.view')}>
                {(['order', 'priority'] as const).map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? 'on' : ''} onClick={() => pickView(v)}>
                    {t(v === 'order' ? 'prio.myOrder' : 'prio.byPriority')}
                  </button>
                ))}
              </div>
            </div>
          )}
          {view === 'priority' && tasks.length > 1 ? (
            <PriorityList tasks={tasks} sensors={sensors} renderCard={card} onCommit={commitPriority} t={t} />
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={tasks.map((x) => x.id)} strategy={verticalListSortingStrategy}>
                <div className="tstack">
                  {tasks.map((task) => <Fragment key={task.id}>{card(task)}</Fragment>)}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </>
      )}
      <button type="button" className="ptm-open" onClick={() => setPlanning(true)}>
        🌙 {t('ptm.title')}{tomorrowCount > 0 && <span className="num"> · {t('ptm.planned', { n: tomorrowCount })}</span>}
      </button>
    </div>
    {editing && <TaskForm task={editing} onClose={() => setEditing(null)} />}
    {planning && <PlanTomorrow summary={{ done: doneCount, total: tasks.length, focusedMin }} onClose={() => setPlanning(false)} />}
    {editingHabit && (
      <HabitEdit habit={editingHabit === 'new' ? null : editingHabit} onClose={() => setEditingHabit(null)} />
    )}
    <QuickLaunch t={t} />
    </div>
  )
}
