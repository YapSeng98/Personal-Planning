import { useEffect, useState, useCallback } from 'react'
import { db, uuid, writeAndQueue, rollUpGoal, CHANGED, type Goal, type GoalType } from '../db/db'
import { syncNow } from '../sync/engine'

const ORDER: GoalType[] = ['vision', 'year', 'quarter', 'month', 'week']
const LABEL: Record<GoalType, string> = {
  vision: 'Vision',
  year: 'Year goals',
  quarter: 'Quarter goals',
  month: 'Month goals',
  week: 'Week goals',
}
const STATUSES = ['not_started', 'in_progress', 'at_risk', 'completed', 'abandoned'] as const

const blank = {
  title: '',
  type: 'year' as GoalType,
  parentId: '',
  targetDate: '',
  status: 'not_started' as Goal['status'],
  progress: 0,
}

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...blank })

  const load = useCallback(async () => {
    setGoals(await db.goals.filter((g) => !g.deleted).toArray())
  }, [])
  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  function startCreate() {
    setEditingId(null)
    setForm({ ...blank })
    setOpen(true)
  }

  function startEdit(g: Goal) {
    setEditingId(g.id)
    setForm({
      title: g.title,
      type: g.type,
      parentId: g.parentId ?? '',
      targetDate: g.targetDate ?? '',
      status: g.status,
      progress: g.progress,
    })
    setOpen(true)
  }

  async function save() {
    if (!form.title.trim()) return
    const existing = editingId ? await db.goals.get(editingId) : undefined
    const goal: Goal = {
      id: editingId ?? uuid(),
      lifeArea: existing?.lifeArea,
      whyItMatters: existing?.whyItMatters,
      title: form.title.trim(),
      type: form.type,
      parentId: form.parentId || undefined,
      targetDate: form.targetDate || undefined,
      status: form.status,
      progress: Math.max(0, Math.min(100, Number(form.progress) || 0)),
      deleted: 0,
      updatedAt: Date.now(),
    }
    await writeAndQueue(db.goals, 'goal', goal)
    await rollUpGoal(goal.id) // refresh: from linked tasks if any, then ancestors
    setOpen(false)
    syncNow()
  }

  async function remove() {
    if (!editingId) return
    const g = await db.goals.get(editingId)
    if (!g) return
    const tombstone: Goal = { ...g, deleted: 1, updatedAt: Date.now() }
    await writeAndQueue(db.goals, 'goal', tombstone)
    if (g.parentId) await rollUpGoal(g.parentId)
    setOpen(false)
    syncNow()
  }

  const byId = new Map(goals.map((g) => [g.id, g]))
  const parentOptions = goals.filter(
    (g) => g.id !== editingId && ORDER.indexOf(g.type) === ORDER.indexOf(form.type) - 1,
  )
  const hasLinkedTasks = false // hint text only; roll-up decides for real

  return (
    <div>
      <div className="greet page-head">
        <div>
          <h1>Goals</h1>
          <div className="sub">Vision → Year → Quarter → Month → Week — progress rolls up. Tap a goal to edit.</div>
        </div>
        <button className="btn btn-primary" onClick={startCreate}>+ Goal</button>
      </div>

      {ORDER.map((t) => {
        const group = goals.filter((g) => g.type === t)
        if (group.length === 0) return null
        return (
          <div key={t}>
            <div className="section-h">{LABEL[t]}</div>
            <div className="stack" style={{ marginTop: 0 }}>
              {group.map((g) => (
                <button key={g.id} className="card goal-card" onClick={() => startEdit(g)}>
                  <div className="top">
                    <span className="t">{g.title}</span>
                    <span className="pct num">{g.progress}%</span>
                  </div>
                  <div className="pbar"><i style={{ width: `${g.progress}%` }} /></div>
                  <div className="meta">
                    {g.parentId && byId.get(g.parentId) ? `↑ ${byId.get(g.parentId)!.title}` : ''}
                    {g.targetDate ? `  ·  due ${g.targetDate}` : ''}
                    {`  ·  ${g.status.replace('_', ' ')}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {goals.length === 0 && <div className="empty">No goals yet — add a Year goal to anchor everything.</div>}

      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              autoFocus
              placeholder="Goal title… e.g. “Increase portfolio by 20%”"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <div className="form-grid">
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as GoalType, parentId: '' })}
                aria-label="Goal level"
              >
                {ORDER.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}
              </select>
              {parentOptions.length > 0 && (
                <select
                  value={form.parentId}
                  onChange={(e) => setForm({ ...form, parentId: e.target.value })}
                  aria-label="Parent goal"
                >
                  <option value="">No parent</option>
                  {parentOptions.map((p) => <option key={p.id} value={p.id}>↑ {p.title}</option>)}
                </select>
              )}
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as Goal['status'] })}
                aria-label="Status"
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
              <input
                type="date"
                value={form.targetDate}
                onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
                aria-label="Target date"
              />
              <label className="progress-edit">
                Progress
                <input
                  type="number" min="0" max="100"
                  value={form.progress}
                  onChange={(e) => setForm({ ...form, progress: Number(e.target.value) })}
                />
                %
              </label>
            </div>
            <p className="hint">
              {hasLinkedTasks ? '' : 'Progress you type here is kept until tasks are linked — once tasks (or child goals) exist, it\'s calculated from them automatically.'}
            </p>
            <div className="row" style={{ justifyContent: editingId ? 'space-between' : 'flex-end' }}>
              {editingId && <button className="btn btn-danger" onClick={remove}>Delete</button>}
              <span style={{ display: 'flex', gap: '0.6rem' }}>
                <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={save}>{editingId ? 'Save goal' : 'Add goal'}</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
