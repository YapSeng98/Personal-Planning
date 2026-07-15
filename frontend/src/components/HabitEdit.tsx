import { useState } from 'react'
import { db, uuid, writeAndQueue, type Habit } from '../db/db'
import { syncNow } from '../sync/engine'

const EMOJIS = ['💧', '🏃', '📖', '🧘', '💪', '😴', '🥗', '✍️', '🌿', '💊']

export default function HabitEdit({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  const [name, setName] = useState(habit?.name ?? '')
  const [emoji, setEmoji] = useState(habit?.emoji ?? '💧')
  // Kept as text while typing (so clearing the field doesn't snap back to 0);
  // parsed and clamped only on save.
  const [target, setTarget] = useState(habit ? String(habit.targetPerDay) : '1')

  async function save() {
    if (!name.trim()) return
    const h: Habit = {
      id: habit?.id ?? uuid(),
      sysId: habit?.sysId,
      name: name.trim(),
      emoji: emoji.trim() || '✅',
      frequency: 'daily',
      targetPerDay: Math.max(1, parseInt(target, 10) || 1),
      active: 1,
      deleted: 0,
      updatedAt: Date.now(),
    }
    await writeAndQueue(db.habits, 'habit', h)
    syncNow()
    onClose()
  }

  async function remove() {
    if (!habit) return
    if (!window.confirm(`Delete habit "${habit.name}"? Its logged history stays saved.`)) return
    const tombstone: Habit = { ...habit, deleted: 1, active: 0, updatedAt: Date.now() }
    await writeAndQueue(db.habits, 'habit', tombstone)
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
          placeholder="Habit name… e.g. “Drink water”"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <div className="form-grid">
          <div className="f">
            <label className="fl">Icon</label>
            <div className="emoji-row">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`emoji-btn ${emoji === e ? 'on' : ''}`}
                  onClick={() => setEmoji(e)}
                  aria-label={`Icon ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="f">
            <label className="fl">Times per day (water = 8, most habits = 1)</label>
            <input
              type="number" min="1" max="99" inputMode="numeric" placeholder="1"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
        </div>
        </div>
        <div className="row sheet-actions" style={{ justifyContent: habit ? 'space-between' : 'flex-end' }}>
          {habit && <button className="btn btn-danger" onClick={remove}>Delete</button>}
          <span style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>{habit ? 'Save habit' : 'Add habit'}</button>
          </span>
        </div>
      </div>
    </div>
  )
}
