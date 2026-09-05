import { useEffect, useState, useCallback, useRef } from 'react'
import {
  DndContext, useDroppable, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, closestCorners, type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { db, uuid, writeAndQueue, rollUpGoal, byOrder, nextCompletedAt, CHANGED, type Task, type Project, type TaskState } from '../db/db'
import { syncNow } from '../sync/engine'
import Select from '../components/Select'
import TaskForm from '../components/TaskForm'
import ProjectForm from '../components/ProjectForm'
import { projectColorVar } from '../lib/projectColors'
import { computeProjectStats, type ProjectStat } from '../lib/projectStats'
import { useLang } from '../lib/i18n'

const RING_R = 26
const RING_C = 2 * Math.PI * RING_R

function ProjectCard({
  stat, proj, selected, maxSpark, onSelect,
}: { stat: ProjectStat; proj: Project; selected: boolean; maxSpark: number; onSelect: () => void }) {
  const { t } = useLang()
  // "New" (never completed anything) and "quiet" (has a history, just none
  // in the literal last 7 days, but not idle long enough to count as
  // stalled) are different states — a project with 26 done tasks and none
  // this week is not "just started".
  const statusCls = stat.stalled ? 'stalled' : stat.weekDone > 0 ? 'up' : stat.done === 0 ? 'new' : ''
  const statusText = stat.stalled
    ? stat.daysSinceLastDone == null ? t('board.projNoActivity') : t('board.projStalled', { n: stat.daysSinceLastDone })
    : stat.weekDone > 0 ? t('board.projWeekDone', { n: stat.weekDone })
    : stat.done === 0 ? t('board.projNew')
    : t('board.projQuiet')
  return (
    <button className={`card proj-card ${selected ? 'on' : ''}`} onClick={onSelect}>
      <div className="proj-top">
        <span className="proj-dot" style={{ background: projectColorVar(proj.color), width: 10, height: 10, borderRadius: '50%', flexShrink: 0 }} />
        <span className="proj-name">{proj.title}</span>
      </div>
      <div className="proj-body">
        <svg className="proj-ring" width="60" height="60" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r={RING_R} fill="none" stroke="var(--glass-strong)" strokeWidth="6" />
          <circle
            cx="30" cy="30" r={RING_R} fill="none" stroke="url(#projRingGrad)" strokeWidth="6"
            strokeLinecap="round" strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - stat.pct / 100)}
            transform="rotate(-90 30 30)"
          />
          <text x="30" y="35" textAnchor="middle" fontSize="15">{stat.pct}%</text>
        </svg>
        <div className="proj-stats">
          <span className="proj-count num">{t('board.projTasks', { done: stat.done, total: stat.total })}</span>
          <span className={`proj-status ${statusCls}`}><i />{statusText}</span>
          <div className="proj-spark">
            {stat.spark.map((v, i) => (
              <b key={i} style={{ height: `${Math.max(2, Math.round((v / maxSpark) * 18))}px` }} />
            ))}
          </div>
        </div>
      </div>
    </button>
  )
}

const STORE_KEY = 'planner_board_project'
const ALL_PROJECTS = '__all__'
const COLUMNS: { status: TaskState; labelKey: string }[] = [
  { status: 'open', labelKey: 'board.colTodo' },
  { status: 'in_progress', labelKey: 'board.colInProgress' },
  { status: 'done', labelKey: 'board.colDone' },
]

// Cross-project view sorts by due date instead of the per-project sortOrder
// field (which only has meaning within one project's own column) — earliest
// due date first, undated tasks sink to the bottom.
function byDue(a: Task, b: Task): number {
  const ad = a.due || '9999-99-99'
  const bd = b.due || '9999-99-99'
  if (ad !== bd) return ad.localeCompare(bd)
  return a.id.localeCompare(b.id)
}

function BoardCard({ task, proj, onEdit }: { task: Task; proj?: Project; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id })
  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="card board-card"
      onClick={onEdit}
      {...listeners}
      {...attributes}
    >
      {proj && <span className="b-acc" style={{ background: projectColorVar(proj.color) }} />}
      <div className="t">{task.title}</div>
      {(task.due || Boolean(task.isMit) || task.recurrence || proj) && (
        <div className="meta">
          {Boolean(task.isMit) && <span>⭐</span>}
          {task.recurrence && <span>🔁</span>}
          {task.due && <span className="num">{task.due.slice(5)}</span>}
          {proj && (
            <span className="tchip" style={{ background: 'var(--accent-wash)', color: 'var(--text-2)' }}>
              <span className="cd" style={{ background: projectColorVar(proj.color) }} />
              {proj.title}
            </span>
          )}
        </div>
      )}
    </button>
  )
}

function BoardColumn({
  status, label, tasks, projectsById, draft, onDraftChange, onAdd, onEdit, emptyLabel, addPh, canAdd,
}: {
  status: TaskState
  label: string
  tasks: Task[]
  projectsById?: Record<string, Project>
  draft: string
  onDraftChange: (v: string) => void
  onAdd: () => void
  onEdit: (t: Task) => void
  emptyLabel: string
  addPh: string
  canAdd: boolean
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div className={`board-col st-${status.replace('_', '')}`}>
      <div className="board-col-h">
        <span className="n">{label}</span>
        <span className="c num">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className={`board-drop ${isOver ? 'over' : ''}`}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <BoardCard key={task.id} task={task} proj={task.projectId ? projectsById?.[task.projectId] : undefined} onEdit={() => onEdit(task)} />
          ))}
        </SortableContext>
        {tasks.length === 0 && <div className="board-empty-col">{emptyLabel}</div>}
      </div>
      {status === 'open' && canAdd && (
        <input
          className="add-inline"
          type="text"
          placeholder={addPh}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          aria-label={addPh}
        />
      )}
    </div>
  )
}

export default function Board() {
  const [projects, setProjects] = useState<Project[]>([])
  const [selected, setSelected] = useState('')
  const [tasks, setTasks] = useState<Task[]>([])
  const [draft, setDraft] = useState('')
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [projectSheet, setProjectSheet] = useState<'closed' | 'new' | Project>('closed')
  const [stats, setStats] = useState<ProjectStat[]>([])
  const addingRef = useRef(false)
  const { t } = useLang()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const loadProjects = useCallback(async () => {
    const rows = await db.projects.filter((p) => !p.deleted && !p.archived).toArray()
    setProjects(rows)
    setSelected((cur) => {
      if (cur === ALL_PROJECTS || (cur && rows.some((p) => p.id === cur))) return cur
      const stored = localStorage.getItem(STORE_KEY)
      if (stored === ALL_PROJECTS || (stored && rows.some((p) => p.id === stored))) return stored!
      return rows[0]?.id ?? ''
    })
  }, [])

  const loadStats = useCallback(async () => {
    setStats(await computeProjectStats())
  }, [])

  const loadTasks = useCallback(async (projectId: string) => {
    if (!projectId) {
      setTasks([])
      return
    }
    const rows = projectId === ALL_PROJECTS
      ? await db.tasks.filter((x) => !x.deleted && x.state !== 'cancelled').toArray()
      : await db.tasks.where('projectId').equals(projectId).and((x) => !x.deleted && x.state !== 'cancelled').toArray()
    setTasks(rows)
  }, [])

  useEffect(() => {
    loadProjects()
    window.addEventListener(CHANGED, loadProjects)
    return () => window.removeEventListener(CHANGED, loadProjects)
  }, [loadProjects])

  useEffect(() => {
    loadStats()
    window.addEventListener(CHANGED, loadStats)
    return () => window.removeEventListener(CHANGED, loadStats)
  }, [loadStats])

  useEffect(() => {
    loadTasks(selected)
    if (selected) localStorage.setItem(STORE_KEY, selected)
    const reload = () => loadTasks(selected)
    window.addEventListener(CHANGED, reload)
    return () => window.removeEventListener(CHANGED, reload)
  }, [selected, loadTasks])

  const isAll = selected === ALL_PROJECTS
  const projectsById = Object.fromEntries(projects.map((p) => [p.id, p]))
  const colTasks = (status: TaskState) =>
    tasks.filter((x) => x.state === status).sort(isAll ? byDue : byOrder)

  async function addTask() {
    const title = draft.trim()
    if (!title || !selected || isAll || addingRef.current) return
    addingRef.current = true
    try {
      const openCount = tasks.filter((x) => x.state === 'open').length
      await writeAndQueue(db.tasks, 'task', {
        id: uuid(),
        title,
        state: 'open',
        priority: 3,
        projectId: selected,
        sortOrder: openCount,
        deleted: 0,
        updatedAt: Date.now(),
      })
      setDraft('')
      syncNow()
    } finally {
      addingRef.current = false
    }
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    const moved = tasks.find((x) => x.id === activeId)
    if (!moved) return

    const isStatusId = COLUMNS.some((c) => c.status === overId)
    const overTask = tasks.find((x) => x.id === overId)
    const targetState: TaskState = isStatusId ? (overId as TaskState) : overTask?.state ?? moved.state

    // All-projects view is sorted by due date, not the per-project sortOrder
    // field — dragging here can only change status (which column a task is
    // in), never persisted position. Rewriting sortOrder across tasks that
    // belong to different projects would scramble each project's own board
    // the next time it's opened individually.
    if (isAll) {
      if (moved.state === targetState) return
      await writeAndQueue(db.tasks, 'task', {
        ...moved, state: targetState,
        completedAt: nextCompletedAt(moved.state, moved.completedAt, targetState),
        updatedAt: Date.now(),
      })
      if (moved.goalId) await rollUpGoal(moved.goalId)
      syncNow()
      return
    }

    // rebuild the target column's order with the moved task inserted at the drop point
    const colIds = tasks.filter((x) => x.state === targetState && x.id !== activeId).sort(byOrder).map((x) => x.id)
    let idx = colIds.length
    if (!isStatusId) {
      const oi = colIds.indexOf(overId)
      idx = oi >= 0 ? oi : colIds.length
    }
    const newIds = [...colIds.slice(0, idx), activeId, ...colIds.slice(idx)]

    const now = Date.now()
    let wrote = false
    for (let i = 0; i < newIds.length; i++) {
      const task = tasks.find((x) => x.id === newIds[i])!
      const stateChanged = task.id === activeId && task.state !== targetState
      if (task.sortOrder === i && !stateChanged) continue
      const patch: Task = { ...task, sortOrder: i, updatedAt: now }
      if (task.id === activeId) {
        patch.state = targetState
        patch.completedAt = nextCompletedAt(task.state, task.completedAt, targetState)
      }
      await writeAndQueue(db.tasks, 'task', patch)
      wrote = true
    }
    if (moved.state !== targetState && moved.goalId) await rollUpGoal(moved.goalId)
    if (wrote) syncNow()
  }

  const project = projects.find((p) => p.id === selected)
  const maxSpark = Math.max(1, ...stats.flatMap((x) => x.spark))

  return (
    <div>
      <div className="greet page-head">
        <div>
          <h1>{t('board.title')}</h1>
          <div className="sub">{isAll ? t('board.allProjectsSub') : t('board.sub')}</div>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="card empty-cta">
          <p>{t('board.noProjects')}</p>
          <button className="btn btn-primary" onClick={() => setProjectSheet('new')}>
            {t('board.createFirst')}
          </button>
        </div>
      ) : (
        <>
          {stats.length > 0 && (
            <>
              <div className="section-h">{t('board.projOverview')}</div>
              <svg width="0" height="0" style={{ position: 'absolute' }}>
                <defs>
                  <linearGradient id="projRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="var(--accent-bright)" />
                    <stop offset="100%" stopColor="var(--amber)" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="proj-strip">
                {stats.map((s) => {
                  const proj = projectsById[s.id]
                  if (!proj) return null
                  return (
                    <ProjectCard
                      key={s.id}
                      stat={s}
                      proj={proj}
                      selected={s.id === selected}
                      maxSpark={maxSpark}
                      onSelect={() => setSelected(s.id)}
                    />
                  )
                })}
              </div>
            </>
          )}

          <div className="board-head">
            <Select
              ariaLabel={t('board.selectProject')}
              value={selected}
              onChange={setSelected}
              options={[
                { value: ALL_PROJECTS, label: t('board.allProjects') },
                ...projects.map((p) => ({ value: p.id, label: p.title })),
              ]}
            />
            {project && <span className="project-dot" style={{ background: projectColorVar(project.color) }} />}
            {project && (
              <button className="btn" onClick={() => setProjectSheet(project)}>
                {t('board.editProject')}
              </button>
            )}
            <button className="btn" onClick={() => setProjectSheet('new')}>
              {t('board.newProject')}
            </button>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={handleDragEnd}>
            <div className="board-cols">
              {COLUMNS.map((col) => (
                <BoardColumn
                  key={col.status}
                  status={col.status}
                  label={t(col.labelKey)}
                  tasks={colTasks(col.status)}
                  projectsById={isAll ? projectsById : undefined}
                  draft={draft}
                  onDraftChange={setDraft}
                  onAdd={addTask}
                  onEdit={setEditingTask}
                  emptyLabel={t('board.emptyColumn')}
                  addPh={t('plan.addTask')}
                  canAdd={!isAll}
                />
              ))}
            </div>
          </DndContext>
        </>
      )}

      {editingTask && <TaskForm task={editingTask} onClose={() => setEditingTask(null)} />}
      {projectSheet !== 'closed' && (
        <ProjectForm
          project={projectSheet === 'new' ? null : projectSheet}
          onClose={() => setProjectSheet('closed')}
          onSaved={setSelected}
        />
      )}
    </div>
  )
}
