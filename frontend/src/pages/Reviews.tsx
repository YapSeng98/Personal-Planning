import { useEffect, useState, useCallback } from 'react'
import { db, uuid, todayStr, writeAndQueue, CHANGED, type Review } from '../db/db'
import { syncNow } from '../sync/engine'

type RType = Review['type']
const TYPES: RType[] = ['daily', 'weekly', 'monthly', 'yearly']
const MOODS: [Review['mood'], string][] = [
  ['great', '😊'],
  ['good', '🙂'],
  ['okay', '😐'],
  ['bad', '☹️'],
]

function periodFor(type: RType): { start: string; end: string } {
  const now = new Date()
  if (type === 'daily') {
    const t = todayStr()
    return { start: t, end: t }
  }
  if (type === 'weekly') {
    const mon = new Date(now)
    mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    return { start: todayStr(mon), end: todayStr(sun) }
  }
  if (type === 'monthly') {
    return {
      start: todayStr(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: todayStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    }
  }
  return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` }
}

const blank = { wins: '', failures: '', lesson: '', next: '', mood: undefined as Review['mood'], energy: 0 }

export default function Reviews() {
  const [type, setType] = useState<RType>('daily')
  const [form, setForm] = useState({ ...blank })
  const [existingId, setExistingId] = useState<string | null>(null)
  const [stats, setStats] = useState('')
  const [past, setPast] = useState<Review[]>([])
  const [flash, setFlash] = useState('')

  const load = useCallback(async () => {
    const { start, end } = periodFor(type)

    // Pre-fill the numbers so reflection starts from facts, not recall.
    const tasks = await db.tasks
      .filter((t) => !t.deleted && !!t.due && t.due! >= start && t.due! <= end)
      .toArray()
    const done = tasks.filter((t) => t.state === 'done').length
    const checkins = await db.habitLogs
      .filter((l) => !l.deleted && l.count > 0 && l.date >= start && l.date <= end)
      .count()
    setStats(
      tasks.length || checkins
        ? `${done} of ${tasks.length} tasks done · ${checkins} habit check-in${checkins === 1 ? '' : 's'}`
        : 'Nothing logged in this period yet.',
    )

    const existing = await db.reviews
      .filter((r) => !r.deleted && r.type === type && r.periodStart === start)
      .first()
    setExistingId(existing?.id ?? null)
    setForm(
      existing
        ? {
            wins: existing.wins ?? '',
            failures: existing.failures ?? '',
            lesson: existing.lesson ?? '',
            next: existing.nextPriorities ?? '',
            mood: existing.mood,
            energy: existing.energy ?? 0,
          }
        : { ...blank },
    )

    const all = await db.reviews.filter((r) => !r.deleted).toArray()
    all.sort((a, b) => b.periodStart.localeCompare(a.periodStart))
    setPast(all.slice(0, 6))
  }, [type])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  async function save() {
    const { start, end } = periodFor(type)
    await writeAndQueue(db.reviews, 'review', {
      id: existingId ?? uuid(),
      type,
      periodStart: start,
      periodEnd: end,
      wins: form.wins || undefined,
      failures: form.failures || undefined,
      lesson: form.lesson || undefined,
      nextPriorities: form.next || undefined,
      mood: form.mood,
      energy: form.energy || undefined,
      deleted: 0,
      updatedAt: Date.now(),
    })
    syncNow()
    setFlash('Saved ✓')
    setTimeout(() => setFlash(''), 2000)
  }

  const { start, end } = periodFor(type)
  const periodLabel = type === 'daily' ? start : `${start} → ${end}`

  return (
    <div>
      <div className="greet">
        <h1>Reviews</h1>
        <div className="sub">Reflect on facts, not memory — the numbers are pre-filled.</div>
      </div>

      <div className="tabs" role="tablist">
        {TYPES.map((t) => (
          <button key={t} role="tab" aria-selected={t === type} className={`tab ${t === type ? 'on' : ''}`} onClick={() => setType(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="stack">
        <div className="card card-ai briefing">
          <div className="lbl grad-text">✦ {periodLabel}, in numbers</div>
          <div className="txt">{stats}</div>
        </div>

        <div>
          <div className="section-h">What went well?</div>
          <textarea className="field" value={form.wins} onChange={(e) => setForm({ ...form, wins: e.target.value })} placeholder="Wins, big or small…" />
        </div>
        <div>
          <div className="section-h">What didn't?</div>
          <textarea className="field" value={form.failures} onChange={(e) => setForm({ ...form, failures: e.target.value })} placeholder="What failed or slipped…" />
        </div>
        <div>
          <div className="section-h">Biggest lesson</div>
          <textarea className="field" value={form.lesson} onChange={(e) => setForm({ ...form, lesson: e.target.value })} placeholder="One thing to carry forward…" />
        </div>

        <div>
          <div className="section-h">Mood · Energy</div>
          <div className="card mood-row">
            {MOODS.map(([m, emoji]) => (
              <button key={m} className={`mood-btn ${form.mood === m ? 'on' : ''}`} onClick={() => setForm({ ...form, mood: m })} aria-label={`Mood: ${m}`}>
                {emoji}
              </button>
            ))}
            <span className="energy-row" aria-label="Energy level">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} className={`dot ${form.energy >= n ? 'on' : ''}`} onClick={() => setForm({ ...form, energy: n })} aria-label={`Energy ${n} of 5`} />
              ))}
            </span>
          </div>
        </div>

        <div>
          <div className="section-h">{type === 'daily' ? "Tomorrow's priorities" : 'Next period priorities'}</div>
          <textarea className="field" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} placeholder="Top things to focus on next…" />
        </div>

        <div className="row" style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={save}>{existingId ? 'Update review' : 'Save review'}</button>
          {flash && <span className="flash" role="status">{flash}</span>}
        </div>

        {past.length > 0 && (
          <div>
            <div className="section-h">Past reviews</div>
            <div className="review-past">
              {past.map((r) => (
                <div key={r.id} className="card rp">
                  <b>{r.type}</b> · {r.periodStart}
                  {r.mood ? ` · ${MOODS.find(([m]) => m === r.mood)?.[1]}` : ''}
                  {r.wins ? ` — ${r.wins.slice(0, 60)}${r.wins.length > 60 ? '…' : ''}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
