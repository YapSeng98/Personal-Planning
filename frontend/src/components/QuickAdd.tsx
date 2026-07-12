import { useState } from 'react'
import { db, uuid, todayStr, writeAndQueue, type Task } from '../db/db'
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

  async function add() {
    if (!text.trim()) return
    await writeAndQueue(db.tasks, 'task', parse(text))
    syncNow()
    onClose()
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
        <p className="hint">Understands “tomorrow”, times like “6am”, and durations like “2h”. Saved locally first, synced when online.</p>
        <div className="row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={add}>Add task</button>
        </div>
      </div>
    </div>
  )
}
