import { useEffect, useState } from 'react'
import { db, uuid, todayStr, writeAndQueue, rollUpGoal, type Task, type Goal } from '../db/db'
import { syncNow } from '../sync/engine'

/** Lightweight natural-language parse: "gym tomorrow 6am", "report 2h friday".
    Local and rule-based — the same box upgrades to the AI assistant in Phase 3. */
function parse(input: string): Task {
  let title = input.trim()
  let due = todayStr()
  let timeBlockStart: string | undefined
  let estimatedHours: number | undefined

  const tomorrow = /\btomorrow\b/i
  if (tomorrow.test(title)) {
    due = todayStr(new Date(Date.now() + 86400_000))
    title = title.replace(tomorrow, '').trim()
  }
  const time = title.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (time) {
    let h = parseInt(time[1], 10) % 12
    if (time[3].toLowerCase() === 'pm') h += 12
    timeBlockStart = `${due}T${String(h).padStart(2, '0')}:${time[2] ?? '00'}`
    title = title.replace(time[0], '').trim()
  }
  const dur = title.match(/\b(\d+(?:\.\d+)?)h\b/i)
  if (dur) {
    estimatedHours = parseFloat(dur[1])
    title = title.replace(dur[0], '').trim()
  }

  return {
    id: uuid(),
    title: title || input.trim(),
    state: 'open',
    priority: 3,
    due,
    timeBlockStart,
    estimatedHours,
    deleted: 0,
    updatedAt: Date.now(),
  }
}

export default function QuickAdd({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [goalId, setGoalId] = useState('')
  const [goals, setGoals] = useState<Goal[]>([])
  const [savedNote, setSavedNote] = useState('')

  useEffect(() => {
    // Week/month goals are what daily tasks realistically serve.
    db.goals
      .filter((g) => !g.deleted && g.status !== 'completed' && (g.type === 'week' || g.type === 'month'))
      .toArray()
      .then(setGoals)
  }, [])

  async function add() {
    if (!text.trim()) return
    const task = parse(text)
    if (goalId) task.goalId = goalId
    await writeAndQueue(db.tasks, 'task', task)
    if (task.goalId) await rollUpGoal(task.goalId)
    syncNow()
    if (task.due !== todayStr()) {
      // Don't let a "tomorrow" task vanish silently — say where it went.
      setSavedNote(`Added for ${task.due} — you'll see it on the Plan page.`)
      setText('')
      setTimeout(onClose, 1400)
    } else {
      onClose()
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          autoFocus
          placeholder="Add a task… e.g. “gym tomorrow 6am” or “report 2h”"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        {goals.length > 0 && (
          <div className="form-grid" style={{ margin: '0.6rem 0 0' }}>
            <div className="f">
              <label className="fl">Counts toward goal (optional)</label>
              <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                <option value="">No goal link</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>🎯 {g.title}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        <p className="hint">
          {savedNote || 'Understands “tomorrow”, times like “6am”, and durations like “2h”. Linked tasks move their goal\'s progress. Saved locally first, synced when online.'}
        </p>
        <div className="row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={add}>Add task</button>
        </div>
      </div>
    </div>
  )
}
