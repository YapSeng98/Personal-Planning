import { useEffect, useState } from 'react'
import { db, uuid, todayStr, writeAndQueue, rollUpGoal, type Task, type Goal } from '../db/db'
import { syncNow } from '../sync/engine'

/** Parse time + duration from free text ("6am", "2h"). The due date comes
    from the visible date field, so "what you see is what you get". */
function parseExtras(input: string): { title: string; timeBlockStart?: string; estimatedHours?: number; time?: string } {
  let title = input.trim()
  let time: string | undefined
  let estimatedHours: number | undefined

  const t = title.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (t) {
    let h = parseInt(t[1], 10) % 12
    if (t[3].toLowerCase() === 'pm') h += 12
    time = `${String(h).padStart(2, '0')}:${t[2] ?? '00'}`
    title = title.replace(t[0], '').trim()
  }
  const dur = title.match(/\b(\d+(?:\.\d+)?)h\b/i)
  if (dur) {
    estimatedHours = parseFloat(dur[1])
    title = title.replace(dur[0], '').trim()
  }
  return { title, estimatedHours, time }
}

export default function QuickAdd({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [due, setDue] = useState(todayStr())
  const [goalId, setGoalId] = useState('')
  const [goals, setGoals] = useState<Goal[]>([])

  useEffect(() => {
    db.goals
      .filter((g) => !g.deleted && g.status !== 'completed' && (g.type === 'week' || g.type === 'month'))
      .toArray()
      .then(setGoals)
  }, [])

  // Typing "tomorrow" / "today" nudges the visible date field so it always
  // reflects what will actually be saved.
  function onText(v: string) {
    setText(v)
    if (/\btomorrow\b/i.test(v)) setDue(todayStr(new Date(Date.now() + 86400_000)))
    else if (/\btoday\b/i.test(v)) setDue(todayStr())
  }

  async function add() {
    if (!text.trim()) return
    const { title, estimatedHours, time } = parseExtras(text.replace(/\b(tomorrow|today)\b/gi, '').trim())
    const task: Task = {
      id: uuid(),
      title: title || text.trim(),
      state: 'open',
      priority: 3,
      due,
      timeBlockStart: time ? `${due}T${time}` : undefined,
      estimatedHours,
      goalId: goalId || undefined,
      deleted: 0,
      updatedAt: Date.now(),
    }
    await writeAndQueue(db.tasks, 'task', task)
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
            placeholder="Add a task… e.g. “gym 6am” or “report 2h”"
            value={text}
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <div className="form-grid">
            <div className="f">
              <label className="fl">Due date</label>
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            {goals.length > 0 && (
              <div className="f">
                <label className="fl">Counts toward goal (optional)</label>
                <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                  <option value="">No goal link</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>🎯 {g.title}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="hint">Tip: type a time like “6am” or a duration like “2h” and it's picked up automatically. Saved locally first, synced when online.</p>
        </div>
        <div className="row sheet-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={add}>Add task</button>
        </div>
      </div>
    </div>
  )
}
