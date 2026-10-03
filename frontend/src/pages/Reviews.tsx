import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { db, uuid, todayStr, writeAndQueue, CHANGED, type Review, type NoteAttachment } from '../db/db'
import { syncNow } from '../sync/engine'
import { aiEnabled, askAIJson, AI_FORMAT_ERROR } from '../lib/ai'
import { useLang } from '../lib/i18n'
import AutoTextarea from '../components/AutoTextarea'
import { shrinkImage } from '../lib/attach'
import { storeFile, deleteStoredFiles, MAX_STORED_BYTES } from '../lib/files'
import AttachmentChip from '../components/AttachmentChip'

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

const blank = { wins: '', failures: '', lesson: '', next: '', mood: undefined as Review['mood'], energy: 0, attachments: [] as NoteAttachment[] }
type Form = typeof blank

// Cheap equality key for "has the form changed since it was last saved?" —
// attachments by id, so multi-MB data URLs aren't re-serialised per keystroke.
const formKey = (f: Form) =>
  JSON.stringify([f.wins, f.failures, f.lesson, f.next, f.mood ?? '', f.energy, f.attachments.map((a) => a.id)])
const isEmpty = (f: Form) => formKey(f) === formKey(blank)

const AUTOSAVE_MS = 800
const AUTOSYNC_MS = 5000

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
  const [submitting, setSubmitting] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [draftErr, setDraftErr] = useState('')
  const [attachErr, setAttachErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [viewing, setViewing] = useState<NoteAttachment | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { t, lang } = useLang()

  // Auto-save bookkeeping. Refs, not state: the flush on period switch /
  // unmount runs in an effect cleanup and must see the values being left.
  const formRef = useRef(form)
  formRef.current = form
  const savedKeyRef = useRef(formKey(blank)) // form as last loaded/saved
  const idRef = useRef<string | null>(null)
  const loadedPeriodRef = useRef('')
  const syncTimer = useRef<number | undefined>(undefined)

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
    const periodKey = `${type}:${start}`
    // Same period, and the user has typed since the last save: keep their
    // edits rather than resetting the form to what's stored (this reload is
    // usually just our own auto-save echoing back).
    const editing = loadedPeriodRef.current === periodKey && formKey(formRef.current) !== savedKeyRef.current
    if (!editing) {
      const next: Form = existing
        ? {
            wins: existing.wins ?? '',
            failures: existing.failures ?? '',
            lesson: existing.lesson ?? '',
            next: existing.nextPriorities ?? '',
            mood: existing.mood,
            energy: existing.energy ?? 0,
            attachments: existing.attachments ?? [],
          }
        : { ...blank }
      if (loadedPeriodRef.current !== periodKey) setFlash('')
      loadedPeriodRef.current = periodKey
      savedKeyRef.current = formKey(next)
      formRef.current = next
      idRef.current = existing?.id ?? null
      setExistingId(idRef.current)
      setForm(next)
    }

    const all = await db.reviews.filter((r) => !r.deleted).toArray()
    all.sort((a, b) => b.periodStart.localeCompare(a.periodStart))
    setPast(all.slice(0, 6))
  }, [type, period, t])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  async function addFiles(files: File[]) {
    setAttachErr('')
    const added: NoteAttachment[] = []
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const img = await shrinkImage(file)
        // Clipboard images all arrive named "image.png" — give them a
        // name that says when they were taken instead.
        const name = /^image\.\w+$/.test(file.name)
          ? `screenshot-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.${img.name.split('.').pop()}`
          : img.name
        added.push({ id: uuid(), ...img, name })
      } else if (file.size > MAX_STORED_BYTES) {
        setAttachErr(t('rev.attachTooBig', { name: file.name }))
      } else {
        // Non-image files go to Storage, not inline in the review.
        added.push(await storeFile(file))
      }
    }
    if (added.length) setForm((f) => ({ ...f, attachments: [...f.attachments, ...added] }))
  }

  function removeAttachment(id: string) {
    deleteStoredFiles(form.attachments.filter((a) => a.id === id))
    setForm((f) => ({ ...f, attachments: f.attachments.filter((a) => a.id !== id) }))
  }

  // Paste a screenshot anywhere on the page (incl. while typing in a field).
  // Only file pastes are intercepted — pasting text behaves as normal.
  const addFilesRef = useRef(addFiles)
  addFilesRef.current = addFiles
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const cd = e.clipboardData
      if (!cd) return
      const files = Array.from(cd.files)
      if (files.length) {
        e.preventDefault()
        addFilesRef.current(files)
        return
      }
      // Copying a selection that contains images (a Sketches note, a web
      // page) puts them on the clipboard as <img> tags in HTML, not as
      // files. Attach those; any text in the selection still pastes as usual.
      const html = cd.getData('text/html')
      if (!html.includes('<img')) return
      const srcs = Array.from(new DOMParser().parseFromString(html, 'text/html').images, (i) => i.src)
        .filter((src) => /^(data:image\/|https?:)/.test(src))
      if (!srcs.length) return
      if (!cd.getData('text/plain').trim()) e.preventDefault()
      Promise.all(srcs.map(async (src) => {
        try {
          const blob = await (await fetch(src)).blob()
          if (!blob.type.startsWith('image/')) return null
          return new File([blob], `image.${blob.type.split('/')[1] || 'png'}`, { type: blob.type })
        } catch {
          return null // remote image the site won't let us download (CORS)
        }
      })).then((got) => {
        const ok = got.filter((f): f is File => f !== null)
        if (ok.length) addFilesRef.current(ok)
        else setAttachErr(t('rev.attachPasteFail'))
      })
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [t])

  useEffect(() => {
    if (!viewing) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setViewing(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewing])

  function openPast(r: Review) {
    setType(r.type)
    setAnchorDate(r.periodStart)
  }

  async function remove() {
    if (!existingId) return
    const r = await db.reviews.get(existingId)
    if (!r) return
    if (!window.confirm(t('rev.deleteConfirm', { period: periodLabel }))) return
    // Make sure the flush on leaving this period doesn't re-create it.
    idRef.current = null
    formRef.current = { ...blank }
    savedKeyRef.current = formKey(blank)
    setForm({ ...blank })
    setExistingId(null)
    deleteStoredFiles(r.attachments)
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
        ? '你帮助用户回顾一个时期。只返回一个 JSON 对象，键为 wins、failures、lesson、next。每项用第一人称（“我……”）写1-2句，贴合数据，诚实但鼓励。不要输出任何思考过程、解释或前言 — 第一个字符必须是 {，不要 markdown 代码块，不要多余文字。用中文。'
        : "You help the user reflect on a period. Return ONLY a JSON object with keys wins, failures, lesson, next. Each 1-2 sentences in first person ('I ...'), specific to the data, honest but encouraging. Do not include any reasoning, thinking, or preamble — the first character of your reply must be '{'. No markdown code fences, no extra text."
      const j = await askAIJson<{ wins?: string; failures?: string; lesson?: string; next?: string }>(prompt, system)
      setForm((f) => ({
        ...f,
        wins: j.wins || f.wins,
        failures: j.failures || f.failures,
        lesson: j.lesson || f.lesson,
        next: j.next || f.next,
      }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setDraftErr(msg === AI_FORMAT_ERROR ? t('rev.draftErrFormat') : (msg || t('rev.draftErr')))
    } finally {
      setDrafting(false)
    }
  }

  /** Writes the form locally if it changed since the last save. Reads
      everything from refs up front, so it saves the period being left even
      when called from an effect cleanup mid-switch. */
  const persist = useCallback(async (p: { type: RType; start: string; end: string }) => {
    const f = formRef.current
    const k = formKey(f)
    if (k === savedKeyRef.current) return false
    if (!idRef.current && isEmpty(f)) return false
    // Resolve the id once and remember it — a second save racing the
    // CHANGED-triggered reload would otherwise create a duplicate review
    // for the same period instead of updating the first.
    const id = idRef.current ?? uuid()
    idRef.current = id
    savedKeyRef.current = k
    await writeAndQueue(db.reviews, 'review', {
      id,
      type: p.type,
      periodStart: p.start,
      periodEnd: p.end,
      wins: f.wins || undefined,
      failures: f.failures || undefined,
      lesson: f.lesson || undefined,
      nextPriorities: f.next || undefined,
      mood: f.mood,
      energy: f.energy || undefined,
      attachments: f.attachments.length ? f.attachments : undefined,
      deleted: 0,
      updatedAt: Date.now(),
    })
    return true
  }, [])

  // Auto-save: a short pause after any change writes it locally; syncing to
  // the server waits for a longer pause so typing doesn't spam uploads.
  const curPeriod = useMemo(() => ({ type, start: period.start, end: period.end }), [type, period])
  useEffect(() => {
    if (formKey(form) === savedKeyRef.current) return
    const timer = window.setTimeout(async () => {
      if (!(await persist(curPeriod))) return
      setExistingId(idRef.current)
      setFlash(t('rev.autoSaved'))
      window.clearTimeout(syncTimer.current)
      syncTimer.current = window.setTimeout(syncNow, AUTOSYNC_MS)
    }, AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
  }, [form, curPeriod, persist, t])

  // Leaving a period (tab, date, past card) or the page: save what's pending
  // right away instead of waiting out the debounce.
  useEffect(() => {
    return () => {
      persist(curPeriod).then((saved) => { if (saved) syncNow() })
    }
  }, [curPeriod, persist])

  // App backgrounded / tab closed: save and push now.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') persist(curPeriod).finally(() => syncNow())
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [curPeriod, persist])

  async function save() {
    if (submitting) return
    setSubmitting(true)
    try {
      await persist(curPeriod)
      setExistingId(idRef.current)
      window.clearTimeout(syncTimer.current)
      syncNow()
      setFlash(t('rev.saved'))
      setTimeout(() => setFlash(''), 2000)
    } finally {
      setSubmitting(false)
    }
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
          <AutoTextarea className="field" value={form.wins} onChange={(e) => setForm({ ...form, wins: e.target.value })} placeholder={t('rev.winsPh')} />
        </div>
        <div>
          <div className="section-h">{t('rev.fails')}</div>
          <AutoTextarea className="field" value={form.failures} onChange={(e) => setForm({ ...form, failures: e.target.value })} placeholder={t('rev.failsPh')} />
        </div>
        <div>
          <div className="section-h">{t('rev.lesson')}</div>
          <AutoTextarea className="field" value={form.lesson} onChange={(e) => setForm({ ...form, lesson: e.target.value })} placeholder={t('rev.lessonPh')} />
        </div>

        <div>
          <div className="section-h">{t('rev.attachments')}</div>
          <div
            className={`card rev-attach ${dragOver ? 'drag' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(Array.from(e.dataTransfer.files)) }}
          >
            {form.attachments.some((a) => a.type.startsWith('image/')) && (
              <div className="rev-thumbs">
                {form.attachments.filter((a) => a.type.startsWith('image/')).map((a) => (
                  <div key={a.id} className="rev-thumb">
                    <button type="button" className="rev-thumb-img" onClick={() => setViewing(a)} aria-label={a.name}>
                      <img src={a.dataUrl} alt={a.name} />
                    </button>
                    <button type="button" className="rev-thumb-remove" onClick={() => removeAttachment(a.id)} aria-label={t('sketch.removeAttachment')}>×</button>
                  </div>
                ))}
              </div>
            )}
            {form.attachments.some((a) => !a.type.startsWith('image/')) && (
              <div className="sketch-attachments rev-files">
                {form.attachments.filter((a) => !a.type.startsWith('image/')).map((a) => (
                  <AttachmentChip key={a.id} a={a} onRemove={() => removeAttachment(a.id)} />
                ))}
              </div>
            )}
            <div className="rev-attach-bar">
              <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>＋ {t('rev.attachAdd')}</button>
              <span className="rev-attach-hint">{t('rev.attachHint')}</span>
            </div>
            {attachErr && <div className="ai-status err">{attachErr}</div>}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
            />
          </div>
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
          <AutoTextarea className="field" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} placeholder={t('rev.nextPh')} />
        </div>

        <div className="row" style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={save} disabled={submitting}>{existingId ? t('rev.update') : t('rev.save')}</button>
          {existingId && <button className="btn btn-danger" onClick={remove} disabled={submitting}>{t('common.delete')}</button>}
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
                  {r.attachments?.length ? ` · 📎${r.attachments.length}` : ''}
                  {r.wins ? ` — ${r.wins.slice(0, 60)}${r.wins.length > 60 ? '…' : ''}` : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {viewing && (
        <div className="rev-lightbox" onClick={() => setViewing(null)} role="dialog" aria-label={viewing.name}>
          <img src={viewing.dataUrl} alt={viewing.name} />
        </div>
      )}
    </div>
  )
}
