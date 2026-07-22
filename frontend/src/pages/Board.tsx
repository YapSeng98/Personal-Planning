import { useEffect, useState, useCallback } from 'react'
import {
  DndContext, useDraggable, useDroppable, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { db, uuid, writeAndQueue, rollUpGoal, CHANGED, type Task, type Project, type TaskState } from '../db/db'
import { syncNow } from '../sync/engine'
import Select from '../components/Select'
import TaskForm from '../components/TaskForm'
import ProjectForm from '../components/ProjectForm'
import { projectColorVar } from '../lib/projectColors'
import { useLang } from '../lib/i18n'

const STORE_KEY = 'planner_board_project'
const COLUMNS: { status: TaskState; labelKey: string }[] = [
  { status: 'open', labelKey: 'board.colTodo' },
  { status: 'in_progress', labelKey: 'board.colInProgress' },
  { status: 'done', labelKey: 'board.colDone' },
]

function BoardCard({ task, onEdit }: { task: Task; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: task.id })
  return (
    <button
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), opacity: isDragging ? 0.4 : 1 }}
      className="card board-card"
      onClick={onEdit}
      {...listeners}
      {...attributes}
    >
      <div className="t">{task.title}</div>
      {(task.due || Boolean(task.isMit)) && (
        <div className="meta">
          {Boolean(task.isMit) && <span>⭐</span>}
          {task.due && <span className="num">{task.due.slice(5)}</span>}
        </div>
      )}
    </button>
  )
}

function BoardColumn({
  status, label, tasks, draft, onDraftChange, onAdd, onEdit, emptyLabel, addPh,
}: {
  status: TaskState
  label: string
  tasks: Task[]
  draft: string
  onDraftChange: (v: string) => void
  onAdd: () => void
  onEdit: (t: Task) => void
  emptyLabel: string
  addPh: string
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div className={`board-col st-${status.replace('_', '')}`}>
      <div className="board-col-h">
        <span className="n">{label}</span>
        <span className="c num">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className={`board-drop ${isOver ? 'over' : ''}`}>
        {tasks.map((task) => (
          <BoardCard key={task.id} task={task} onEdit={() => onEdit(task)} />
        ))}
        {tasks.length === 0 && <div className="board-empty-col">{emptyLabel}</div>}
      </div>
      {/* single add point (To Do only) — new tasks always start here, then
          move via drag or the task's own status picker */}
      {status === 'open' && (
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
      if (cur && rows.some((p) => p.id === cur)) return cur
      const stored = localStorage.getItem(STORE_KEY)
      if (stored && rows.some((p) => p.id === stored)) return stored
      return rows[0]?.id ?? ''
    })
  }, [])

  const loadTasks = useCallback(async (projectId: string) => {
    if (!projectId) {
      setTasks([])
      return
    }
    const rows = await db.tasks
      .where('projectId')
      .equals(projectId)
      .and((x) => !x.deleted && x.state !== 'cancelled')
      .toArray()
    setTasks(rows)
  }, [])

  useEffect(() => {
    loadProjects()
    window.addEventListener(CHANGED, loadProjects)
    return () => window.removeEventListener(CHANGED, loadProjects)
  }, [loadProjects])

  useEffect(() => {
    loadTasks(selected)
    if (selected) localStorage.setItem(STORE_KEY, selected)
    const reload = () => loadTasks(selected)
    window.addEventListener(CHANGED, reload)
    return () => window.removeEventListener(CHANGED, reload)
  }, [selected, loadTasks])

  async function addTask() {
    const title = draft.trim()
    if (!title || !selected) return
    await writeAndQueue(db.tasks, 'task', {
      id: uuid(),
      title,
      state: 'open',
      priority: 3,
      projectId: selected,
      deleted: 0,
      updatedAt: Date.now(),
    })
    setDraft('')
    syncNow()
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    const task = tasks.find((x) => x.id === active.id)
    const newState = over.id as TaskState
    if (!task || task.state === newState) return
    const updated: Task = { ...task, state: newState, updatedAt: Date.now() }
    await writeAndQueue(db.tasks, 'task', updated)
    if (updated.goalId) await rollUpGoal(updated.goalId)
    syncNow()
  }

  const project = projects.find((p) => p.id === selected)

  return (
    <div>
      <div className="greet page-head">
        <div>
          <h1>{t('board.title')}</h1>
          <div className="sub">{t('board.sub')}</div>
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
          <div className="board-head">
            <Select
              ariaLabel={t('board.selectProject')}
              value={selected}
              onChange={setSelected}
              options={projects.map((p) => ({ value: p.id, label: p.title }))}
            />
            {project && <span className="project-dot" style={{ background: projectColorVar(project.color) }} />}
            <button className="btn" onClick={() => project && setProjectSheet(project)}>
              {t('board.editProject')}
            </button>
            <button className="btn" onClick={() => setProjectSheet('new')}>
              {t('board.newProject')}
            </button>
          </div>

          <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
            <div className="board-cols">
              {COLUMNS.map((col) => (
                <BoardColumn
                  key={col.status}
                  status={col.status}
                  label={t(col.labelKey)}
                  tasks={tasks.filter((x) => x.state === col.status)}
                  draft={draft}
                  onDraftChange={setDraft}
                  onAdd={addTask}
                  onEdit={setEditingTask}
                  emptyLabel={t('board.emptyColumn')}
                  addPh={t('plan.addTask')}
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
