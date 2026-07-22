import { useEffect, useState } from 'react'
import { db, uuid, todayStr, writeAndQueue, rollUpGoal, type Task, type Goal, type Project, type TaskState } from '../db/db'
import { syncNow } from '../sync/engine'
import Select from './Select'
import { useLang } from '../lib/i18n'

// One form for BOTH adding and editing a task, so the two can never diverge.
// task=null → create mode; task=existing → edit mode (adds Delete).

/** Extract a time ("6am") and duration ("2h") from free text — the quick-add
    convenience. Returns the cleaned title plus any values found. */
function parseExtras(input: string) {
  let title = input.trim()
  let time: string | undefined
  let hours: number | undefined
  const t = title.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (t) {
    let h = parseInt(t[1], 10) % 12
    if (t[3].toLowerCase() === 'pm') h += 12
    time = `${String(h).padStart(2, '0')}:${t[2] ?? '00'}`
    title = title.replace(t[0], '').trim()
  }
  const d = title.match(/\b(\d+(?:\.\d+)?)h\b/i)
  if (d) {
    hours = parseFloat(d[1])
    title = title.replace(d[0], '').trim()
  }
  return { title, time, hours }
}

const STATES: TaskState[] = ['open', 'in_progress', 'done', 'cancelled']

export default function TaskForm({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const editing = task !== null
  const [title, setTitle] = useState(task?.title ?? '')
  const [due, setDue] = useState(task?.due ?? todayStr())
  const [start, setStart] = useState(task?.timeBlockStart?.slice(11, 16) ?? '')
  const [end, setEnd] = useState(task?.timeBlockEnd?.slice(11, 16) ?? '')
  const [goalId, setGoalId] = useState(task?.goalId ?? '')
  const [projectId, setProjectId] = useState(task?.projectId ?? '')
  const [state, setState] = useState<TaskState>(task?.state ?? 'open')
  const [isMit, setIsMit] = useState(Boolean(task?.isMit))
  const [hours, setHours] = useState<number | undefined>(task?.estimatedHours)
  const [goals, setGoals] = useState<Goal[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const { t } = useLang()

  useEffect(() => {
    db.goals
      .filter((g) => !g.deleted && g.status !== 'completed' && (g.type === 'week' || g.type === 'month'))
      .toArray()
      .then(setGoals)
    db.projects.filter((p) => !p.deleted && !p.archived).toArray().then(setProjects)
  }, [])

  // While creating, typing natural language fills the structured fields live.
  function onTitle(v: string) {
    if (editing) {
      setTitle(v)
      return
    }
    let working = v
    if (/\btomorrow\b/i.test(working)) {
      setDue(todayStr(new Date(Date.now() + 86400_000)))
      working = working.replace(/\btomorrow\b/gi, '').trim()
    } else if (/\btoday\b/i.test(working)) {
      setDue(todayStr())
      working = working.replace(/\btoday\b/gi, '').trim()
    }
    const { title: cleaned, time, hours: h } = parseExtras(working)
    if (time) setStart(time)
    if (h !== undefined) setHours(h)
    setTitle(time || h !== undefined ? cleaned : working)
  }

  async function save() {
    if (!title.trim()) return
    const record: Task = {
      id: task?.id ?? uuid(),
      sysId: task?.sysId,
      title: title.trim(),
      notes: task?.notes,
      state,
      priority: task?.priority ?? 3,
      due,
      timeBlockStart: start ? `${due}T${start}` : undefined,
      timeBlockEnd: end ? `${due}T${end}` : undefined,
      estimatedHours: hours,
      actualHours: task?.actualHours,
      goalId: goalId || undefined,
      projectId: projectId || undefined,
      isMit,
      deleted: 0,
      updatedAt: Date.now(),
    }
    await writeAndQueue(db.tasks, 'task', record)
    if (task?.goalId && task.goalId !== record.goalId) await rollUpGoal(task.goalId)
    if (record.goalId) await rollUpGoal(record.goalId)
    syncNow()
    onClose()
  }

  async function remove() {
    if (!task) return
    if (!window.confirm(t('task.deleteConfirm', { title: task.title }))) return
    const tombstone: Task = { ...task, deleted: 1, updatedAt: Date.now() }
    await writeAndQueue(db.tasks, 'task', tombstone)
    if (task.goalId) await rollUpGoal(task.goalId)
    syncNow()
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <input
            type="text"
            autoFocus
            placeholder={editing ? '' : t('task.titlePh')}
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            aria-label="Task title"
          />
          <div className="form-grid">
            <div className="f">
              <label className="fl">{t('task.due')}</label>
              <div className={`date-wrap ${due ? '' : 'no-val'}`} data-ph={t('task.tapToSet')}>
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
            </div>
            <div className="f">
              <label className="fl">{t('task.timeBlock')}</label>
              <div className="time-row">
                <div className={`date-wrap ${start ? '' : 'no-val'}`} data-ph={t('task.start')}>
                  <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label={t('task.start')} />
                </div>
                <span>–</span>
                <div className={`date-wrap ${end ? '' : 'no-val'}`} data-ph={t('task.end')}>
                  <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label={t('task.end')} />
                </div>
              </div>
              {(start || end) && (
                <button type="button" className="clear-link" onClick={() => { setStart(''); setEnd('') }}>
                  {t('task.clearTime')}
                </button>
              )}
            </div>
            {goals.length > 0 && (
              <div className="f">
                <label className="fl">{t('task.goal')}</label>
                <Select
                  ariaLabel={t('task.goal')}
                  value={goalId}
                  onChange={setGoalId}
                  options={[{ value: '', label: t('task.noGoal') }, ...goals.map((g) => ({ value: g.id, label: `🎯 ${g.title}` }))]}
                />
              </div>
            )}
            {projects.length > 0 && (
              <div className="f">
                <label className="fl">{t('task.project')}</label>
                <Select
                  ariaLabel={t('task.project')}
                  value={projectId}
                  onChange={setProjectId}
                  options={[{ value: '', label: t('task.noProject') }, ...projects.map((p) => ({ value: p.id, label: `🗂️ ${p.title}` }))]}
                />
              </div>
            )}
            {editing && (
              <div className="f">
                <label className="fl">{t('task.status')}</label>
                <Select
                  ariaLabel={t('task.status')}
                  value={state}
                  onChange={(v) => setState(v as TaskState)}
                  options={STATES.map((s) => ({ value: s, label: t('taskstate.' + s) }))}
                />
              </div>
            )}
            <button
              type="button"
              className={`chip-toggle ${isMit ? 'on' : ''}`}
              onClick={() => setIsMit(!isMit)}
              aria-pressed={isMit}
            >
              ⭐ {t('task.mitFull')} {isMit ? t('task.on') : ''}
            </button>
          </div>
        </div>
        <div className="row sheet-actions" style={{ justifyContent: editing ? 'space-between' : 'flex-end' }}>
          {editing && <button className="btn btn-danger" onClick={remove}>{t('common.delete')}</button>}
          <span style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={save}>{editing ? t('task.save') : t('task.addTask')}</button>
          </span>
        </div>
      </div>
    </div>
  )
}
