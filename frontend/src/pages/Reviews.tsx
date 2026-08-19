import { useEffect, useState, useCallback, useMemo } from 'react'
import { db, uuid, todayStr, writeAndQueue, CHANGED, type Review } from '../db/db'
import { syncNow } from '../sync/engine'
import { aiEnabled, askAI } from '../lib/ai'
import { useLang } from '../lib/i18n'

type RType = Review['type']
const TYPES: RType[] = ['daily', 'weekly', 'monthly', 'yearly']
const MOODS: [Review['mood'], string][] = [
  ['great', '😊'],
  ['good', '🙂'],
  ['okay', '😐'],
  ['bad', '☹️'],
]

// `anchor` defaults to today but can be any date — lets a period be resolved
// for an arbitrary day, e.g. picked from the date field or a past review.
function periodFor(type: RType, anchor: Date = new Date()): { start: string; end: string } {
  if (type === 'daily') {
    const d = todayStr(anchor)
    return { start: d, end: d }
  }
  if (type === 'weekly') {
    const mon = new Date(anchor)
    mon.setDate(anchor.getDate() - ((anchor.getDay() + 6) % 7))
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    return { start: todayStr(mon), end: todayStr(sun) }
  }
  if (type === 'monthly') {
    return {
      start: todayStr(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
      end: todayStr(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)),
    }
  }
  return { start: `${anchor.getFullYear()}-01-01`, end: `${anchor.getFullYear()}-12-31` }
}

const blank = { wins: '', failures: '', lesson: '', next: '', mood: undefined as Review['mood'], energy: 0 }

export default function Reviews() {
  const [type, setType] = useState<RType>('daily')
  // Set when a specific date is picked (via the date field or a "Past
  // reviews" card) — overrides which period is being edited, away from
  // "today", so old entries are reachable and missed days can be backfilled.
  const [anchorDate, setAnchorDate] = useState<string | null>(null)
  const [form, setForm] = useState({ ...blank })
  const [existingId, setExistingId] = useState<string | null>(null)
  const [stats, setStats] = useState('')
  const [past, setPast] = useState<Review[]>([])
  const [flash, setFlash] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [draftErr, setDraftErr] = useState('')
  const { t, lang } = useLang()

  const period = useMemo(
    () => periodFor(type, anchorDate ? new Date(anchorDate + 'T00:00') : new Date()),
    [type, anchorDate],
  )

  const load = useCallback(async () => {
    const { start, end } = period

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
        ? t(checkins === 1 ? 'rev.statLine' : 'rev.statLinePlural', { done, total: tasks.length, checkins })
        : t('rev.statsEmpty'),
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
  }, [type, period, t])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  function openPast(r: Review) {
    setType(r.type)
    setAnchorDate(r.periodStart)
  }

  async function remove() {
    if (!existingId) return
    const r = await db.reviews.get(existingId)
    if (!r) return
    if (!window.confirm(t('rev.deleteConfirm', { period: periodLabel }))) return
    const tombstone: Review = { ...r, deleted: 1, updatedAt: Date.now() }
    await writeAndQueue(db.reviews, 'review', tombstone)
    setAnchorDate(null)
    syncNow()
  }

  async function draftWithAI() {
    setDrafting(true)
    setDraftErr('')
    try {
      const { start, end } = period
      const tasks = await db.tasks.filter((x) => !x.deleted && !!x.due && x.due! >= start && x.due! <= end).toArray()
      const done = tasks.filter((x) => x.state === 'done')
      const notDone = tasks.filter((x) => x.state !== 'done' && x.state !== 'cancelled')
      const checkins = await db.habitLogs.filter((l) => !l.deleted && l.count > 0 && l.date >= start && l.date <= end).count()
      const moodStr = form.mood ? `Mood: ${form.mood}.` : ''
      const energyStr = form.energy ? `Energy: ${form.energy}/5.` : ''
      const prompt = `Reflection period: ${type} (${start}${end !== start ? ` to ${end}` : ''}).\n`
        + `Tasks: ${done.length} of ${tasks.length} done. Habit check-ins: ${checkins}.\n${moodStr} ${energyStr}\n`
        + `Completed: ${done.slice(0, 8).map((x) => x.title).join('; ') || '(none)'}\n`
        + `Not finished: ${notDone.slice(0, 8).map((x) => x.title).join('; ') || '(none)'}\n`
        + `Draft my reflection.`
      const system = lang === 'zh'
        ? '你帮助用户回顾一个时期。只返回一个 JSON 对象，键为 wins、failures、lesson、next。每项用第一人称（“我……”）写1-2句，贴合数据，诚实但鼓励。不要 markdown，不要多余文字。用中文。'
        : "You help the user reflect on a period. Return ONLY a JSON object with keys wins, failures, lesson, next. Each 1-2 sentences in first person ('I ...'), specific to the data, honest but encouraging. No markdown, no extra text."
      const text = await askAI(prompt, system)
      const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
      setForm((f) => ({
        ...f,
        wins: j.wins || f.wins,
        failures: j.failures || f.failures,
        lesson: j.lesson || f.lesson,
        next: j.next || f.next,
      }))
    } catch (e) {
      setDraftErr(e instanceof Error ? e.message : t('rev.draftErr'))
    } finally {
      setDrafting(false)
    }
  }

  async function save() {
    const { start, end } = period
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
    setFlash(t('rev.saved'))
    setTimeout(() => setFlash(''), 2000)
  }

  const { start, end } = period
  const periodLabel = type === 'daily' ? start : `${start} → ${end}`

  return (
    <div>
      <div className="greet">
        <h1>{t('rev.title')}</h1>
        <div className="sub">{t('rev.sub')}</div>
      </div>

      <div className="tabs" role="tablist">
        {TYPES.map((rt) => (
          <button key={rt} role="tab" aria-selected={rt === type} className={`tab ${rt === type ? 'on' : ''}`} onClick={() => { setType(rt); setAnchorDate(null) }}>
            {t('rev.' + rt)}
          </button>
        ))}
      </div>

      <div className={`past-banner ${anchorDate ? 'active' : ''}`}>
        <span className="rev-date-lbl">
          {t('rev.date')}
          <input
            type="date"
            className="rev-date-input"
            value={period.start}
            max={todayStr()}
            onChange={(e) => e.target.value && setAnchorDate(e.target.value)}
            aria-label={t('rev.date')}
          />
        </span>
        {anchorDate && (
          <>
            <span className="rev-editing-tag">{t('rev.viewingPast', { period: periodLabel })}</span>
            <button className="btn" onClick={() => setAnchorDate(null)}>{t('rev.backToToday')}</button>
          </>
        )}
      </div>

      <div className="stack">
        <div className="card card-ai briefing">
          <div className="lbl grad-text">✦ {t('rev.inNumbers', { period: periodLabel })}</div>
          <div className="txt">{stats}</div>
          {aiEnabled() && (
            <button className="btn ai-draft-btn" onClick={draftWithAI} disabled={drafting}>
              {drafting ? t('rev.drafting') : t('rev.aiDraft')}
            </button>
          )}
          {draftErr && <div className="ai-status err">{draftErr}</div>}
        </div>

        <div>
          <div className="section-h">{t('rev.wins')}</div>
          <textarea className="field" value={form.wins} onChange={(e) => setForm({ ...form, wins: e.target.value })} placeholder={t('rev.winsPh')} />
        </div>
        <div>
          <div className="section-h">{t('rev.fails')}</div>
          <textarea className="field" value={form.failures} onChange={(e) => setForm({ ...form, failures: e.target.value })} placeholder={t('rev.failsPh')} />
        </div>
        <div>
          <div className="section-h">{t('rev.lesson')}</div>
          <textarea className="field" value={form.lesson} onChange={(e) => setForm({ ...form, lesson: e.target.value })} placeholder={t('rev.lessonPh')} />
        </div>

        <div>
          <div className="section-h">{t('rev.moodEnergy')}</div>
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
          <div className="section-h">{type === 'daily' ? t('rev.nextDaily') : t('rev.nextOther')}</div>
          <textarea className="field" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} placeholder={t('rev.nextPh')} />
        </div>

        <div className="row" style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={save}>{existingId ? t('rev.update') : t('rev.save')}</button>
          {existingId && <button className="btn btn-danger" onClick={remove}>{t('common.delete')}</button>}
          {flash && <span className="flash" role="status">{flash}</span>}
        </div>

        {past.length > 0 && (
          <div>
            <div className="section-h">{t('rev.past')}</div>
            <div className="review-past">
              {past.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`card rp ${anchorDate === r.periodStart && type === r.type ? 'on' : ''}`}
                  onClick={() => openPast(r)}
                >
                  <b>{t('rev.' + r.type)}</b> · {r.periodStart}
                  {r.mood ? ` · ${MOODS.find(([m]) => m === r.mood)?.[1]}` : ''}
                  {r.wins ? ` — ${r.wins.slice(0, 60)}${r.wins.length > 60 ? '…' : ''}` : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
