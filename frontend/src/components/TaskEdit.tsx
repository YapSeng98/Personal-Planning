import { useEffect, useState } from 'react'
import { db, todayStr, writeAndQueue, rollUpGoal, type Task, type Goal } from '../db/db'
import { syncNow } from '../sync/engine'

export default function TaskEdit({ task, onClose }: { task: Task; onClose: () => void }) {
  const [title, setTitle] = useState(task.title)
  const [due, setDue] = useState(task.due ?? todayStr())
  const [start, setStart] = useState(task.timeBlockStart?.slice(11, 16) ?? '')
  const [end, setEnd] = useState(task.timeBlockEnd?.slice(11, 16) ?? '')
  const [goalId, setGoalId] = useState(task.goalId ?? '')
  const [isMit, setIsMit] = useState(Boolean(task.isMit))
  const [goals, setGoals] = useState<Goal[]>([])

  useEffect(() => {
    db.goals
      .filter((g) => !g.deleted && g.status !== 'completed' && (g.type === 'week' || g.type === 'month'))
      .toArray()
      .then(setGoals)
  }, [])

  async function save() {
    if (!title.trim()) return
    const updated: Task = {
      ...task,
      title: title.trim(),
      due,
      timeBlockStart: start ? `${due}T${start}` : undefined,
      timeBlockEnd: end ? `${due}T${end}` : undefined,
      goalId: goalId || undefined,
      isMit,
      updatedAt: Date.now(),
    }
    await writeAndQueue(db.tasks, 'task', updated)
    // Both the old and new goal need fresh numbers when the link changes.
    if (task.goalId && task.goalId !== updated.goalId) await rollUpGoal(task.goalId)
    if (updated.goalId) await rollUpGoal(updated.goalId)
    syncNow()
    onClose()
  }

  async function remove() {
    if (!window.confirm(`Delete "${task.title}"? It disappears everywhere after sync.`)) return
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
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          aria-label="Task title"
        />
        <div className="form-grid">
          <div className="f">
            <label className="fl">Due date</label>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="f">
            <label className="fl">Time block (optional)</label>
            <div className="time-row">
              <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time" />
              <span>–</span>
              <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End time" />
            </div>
          </div>
          {goals.length > 0 && (
            <div className="f">
              <label className="fl">Counts toward goal</label>
              <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">No goal link</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>🎯 {g.title}</option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            className={`chip-toggle ${isMit ? 'on' : ''}`}
            onClick={() => setIsMit(!isMit)}
            aria-pressed={isMit}
          >
            ⭐ Most Important Task {isMit ? '· on' : ''}
          </button>
        </div>
        </div>
        <div className="row sheet-actions" style={{ justifyContent: 'space-between' }}>
          <button className="btn btn-danger" onClick={remove}>Delete</button>
          <span style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save task</button>
          </span>
        </div>
      </div>
    </div>
  )
}
