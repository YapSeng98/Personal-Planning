import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  db, todayStr, addDays, uuid, OVERDUE_DAYS, isOpenOneOff, writeAndQueue, patchAndQueue, rollUpGoal,
  nextCompletedAt, byOrder, CHANGED, type Task,
} from '../db/db'
import { syncNow } from '../sync/engine'
import { useLang } from '../lib/i18n'
import { hm } from '../lib/timer'
import { parseExtras, moveTasksTo } from '../lib/tasks'
import Icon from './Icon'

/** The end-of-day sheet: what's still open moves to tomorrow in one go,
    tomorrow gets its tasks and its most important one. */
export default function PlanTomorrow({ summary, onClose }: {
  /** Today so far, for the header line. */
  summary: { done: number; total: number; focusedMin: number }
  onClose: () => void
}) {
  const today = todayStr()
  const tomorrow = addDays(today, 1)
  const [open, setOpen] = useState<Task[]>([])
  const [repeating, setRepeating] = useState(0)
  const [next, setNext] = useState<Task[]>([])
  const [draft, setDraft] = useState('')
  const { t, lang } = useLang()
  const navigate = useNavigate()

  const load = useCallback(async () => {
    const late = await db.tasks.where('due').between(addDays(today, -OVERDUE_DAYS), today, true, true)
      .and((x) => !x.deleted && (x.state === 'open' || x.state === 'in_progress')).toArray()
    // today's first, then the most recently missed
    setOpen(late.filter(isOpenOneOff).sort((a, b) => b.due!.localeCompare(a.due!) || byOrder(a, b)))
    setRepeating(late.filter((x) => x.due === today && !isOpenOneOff(x)).length)
    setNext((await db.tasks.where('due').equals(tomorrow).and((x) => !x.deleted).toArray()).sort(byOrder))
  }, [today, tomorrow])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function markDone(task: Task) {
    const saved = await patchAndQueue(db.tasks, 'task', task.id, { state: 'done', completedAt: nextCompletedAt(task.state, task.completedAt, 'done') })
    if (saved?.goalId) await rollUpGoal(saved.goalId)
    syncNow()
  }

  /** One most important task for tomorrow: starring one unstars the rest. */
  async function star(task: Task) {
    const on = !task.isMit
    for (const x of next) {
      if (x.id === task.id) await patchAndQueue(db.tasks, 'task', x.id, { isMit: on })
      else if (on && x.isMit) await patchAndQueue(db.tasks, 'task', x.id, { isMit: false })
    }
    syncNow()
  }

  async function add() {
    const raw = draft.trim()
    if (!raw) return
    setDraft('')
    const { title, time, hours } = parseExtras(raw)
    await writeAndQueue(db.tasks, 'task', {
      id: uuid(), title: title || raw, state: 'open', priority: 3, due: tomorrow,
      timeBlockStart: time ? `${tomorrow}T${time}` : undefined,
      estimatedHours: hours,
      sortOrder: Math.max(-1, ...next.map((x) => x.sortOrder ?? 0)) + 1,
      deleted: 0, updatedAt: Date.now(),
    })
    syncNow()
  }

  const ago = (due: string) => {
    const n = Math.round((new Date(today + 'T00:00').getTime() - new Date(due + 'T00:00').getTime()) / 86400_000)
    return n === 0 ? t('today.todayLabel') : n === 1 ? t('today.yesterday') : t('today.daysAgo', { n })
  }
  const tomorrowLabel = new Date(tomorrow + 'T00:00').toLocaleDateString(lang === 'zh' ? 'zh-CN' : undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet plan-tmr" role="dialog" aria-modal="true" aria-labelledby="ptm-h" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <div className="ptm-head">
            <h2 id="ptm-h">🌙 {t('ptm.title')}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label={t('common.close')}><Icon name="close" size={18} /></button>
          </div>
          <p className="ptm-recap num">
            {t('ptm.recap', { done: summary.done, n: summary.total })}
            {summary.focusedMin >= 1 && <> · ⏱ {t('today.focused', { time: hm(summary.focusedMin / 60) })}</>}
          </p>

          <div className="ptm-sec">
            <div className="ptm-sec-h">
              <span>{t('ptm.stillOpen')} <b className="num">{open.length}</b></span>
              {open.length > 1 && (
                <button type="button" className="btn ptm-all" onClick={() => moveTasksTo(open, tomorrow)}>
                  {t('ptm.moveAll', { n: open.length })}
                </button>
              )}
            </div>
            {open.length === 0 && <p className="ptm-empty">{t('ptm.allClear')}</p>}
            {open.map((task) => (
              <div key={task.id} className="ptm-row">
                <button className="check" onClick={() => markDone(task)} aria-label={t('today.markDone', { title: task.title })}>✓</button>
                <span className="ptm-title" title={task.title}>{task.title}</span>
                <span className="ptm-age">{ago(task.due!)}</span>
                <button type="button" className="overdue-move" onClick={() => moveTasksTo([task], tomorrow)} aria-label={t('ptm.moveFor', { title: task.title })}>
                  {t('ptm.tomorrow')}
                </button>
              </div>
            ))}
            {repeating > 0 && <p className="ptm-note">🔁 {t('ptm.repeating', { n: repeating })}</p>}
          </div>

          <div className="ptm-sec">
            <div className="ptm-sec-h"><span>{t('ptm.tomorrowH', { date: tomorrowLabel })} <b className="num">{next.length}</b></span></div>
            {next.length > 0 && !next.some((x) => x.isMit) && <p className="ptm-note">⭐ {t('ptm.pickMit')}</p>}
            {next.map((task) => (
              <div key={task.id} className="ptm-row">
                <button type="button" className={`ptm-star ${task.isMit ? 'on' : ''}`} onClick={() => star(task)} aria-pressed={!!task.isMit}
                  aria-label={t(task.isMit ? 'ptm.unstar' : 'ptm.star', { title: task.title })} title={t('task.mitFull')}>
                  {task.isMit ? '★' : '☆'}
                </button>
                <span className={`ptm-title ${task.state === 'done' ? 'done' : ''}`} title={task.title}>{task.title}</span>
                <span className="ptm-age num">{task.timeBlockStart ? task.timeBlockStart.slice(11, 16) : ''}</span>
              </div>
            ))}
            <div className="ptm-add">
              <Icon name="plus" size={16} />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
                placeholder={t('ptm.addPh')}
                aria-label={t('ptm.add')}
              />
              <button type="button" className="btn" onClick={add} disabled={!draft.trim()}>{t('today.add')}</button>
            </div>
          </div>
        </div>
        <div className="row sheet-actions" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn" onClick={() => { onClose(); navigate('/reviews') }}>{t('ptm.review')}</button>
          <button type="button" className="btn btn-primary" onClick={onClose}>{t('ptm.done')}</button>
        </div>
      </div>
    </div>
  )
}
