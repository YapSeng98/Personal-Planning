import { useEffect, useState, useCallback } from 'react'
import { db, uuid, writeAndQueue, CHANGED, type Goal, type GoalType } from '../db/db'
import { syncNow } from '../sync/engine'

const ORDER: GoalType[] = ['vision', 'year', 'quarter', 'month', 'week']
const LABEL: Record<GoalType, string> = {
  vision: 'Vision',
  year: 'Year goals',
  quarter: 'Quarter goals',
  month: 'Month goals',
  week: 'Week goals',
}

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<GoalType>('year')
  const [parentId, setParentId] = useState('')
  const [targetDate, setTargetDate] = useState('')

  const load = useCallback(async () => {
    setGoals(await db.goals.filter((g) => !g.deleted).toArray())
  }, [])
  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  async function add() {
    if (!title.trim()) return
    await writeAndQueue(db.goals, 'goal', {
      id: uuid(),
      title: title.trim(),
      type,
      parentId: parentId || undefined,
      progress: 0,
      status: 'not_started',
      targetDate: targetDate || undefined,
      deleted: 0,
      updatedAt: Date.now(),
    })
    setTitle('')
    setParentId('')
    setAdding(false)
    await load()
    syncNow()
  }

  const byId = new Map(goals.map((g) => [g.id, g]))
  // Valid parents live one level up the hierarchy.
  const parentOptions = goals.filter((g) => ORDER.indexOf(g.type) === ORDER.indexOf(type) - 1)

  return (
    <div>
      <div className="greet page-head">
        <div>
          <h1>Goals</h1>
          <div className="sub">Vision → Year → Quarter → Month → Week — progress rolls up.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>+ Goal</button>
      </div>

      {ORDER.map((t) => {
        const group = goals.filter((g) => g.type === t)
        if (group.length === 0) return null
        return (
          <div key={t}>
            <div className="section-h">{LABEL[t]}</div>
            <div className="stack" style={{ marginTop: 0 }}>
              {group.map((g) => (
                <div key={g.id} className="card goal-card">
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
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {goals.length === 0 && <div className="empty">No goals yet — add a Year goal to anchor everything.</div>}

      {adding && (
        <div className="sheet-backdrop" onClick={() => setAdding(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <input
              type="text"
              autoFocus
              placeholder="Goal title… e.g. “Increase portfolio by 20%”"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <div className="form-grid">
              <select value={type} onChange={(e) => { setType(e.target.value as GoalType); setParentId('') }}>
                {ORDER.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}
              </select>
              {parentOptions.length > 0 && (
                <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  <option value="">No parent</option>
                  {parentOptions.map((p) => <option key={p.id} value={p.id}>↑ {p.title}</option>)}
                </select>
              )}
              <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
            </div>
            <div className="row">
              <button className="btn" onClick={() => setAdding(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={add}>Add goal</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
