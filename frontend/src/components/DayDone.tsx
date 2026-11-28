import { useLang } from '../lib/i18n'
import { useEscape } from '../lib/escape'
import { hm } from '../lib/timer'
import type { GoalMove } from '../lib/goals'
import Icon from './Icon'

const SPARKS = 12

/** Today's last task ticked: a moment to enjoy it — once a day (Today keeps
    the date). The ring and sparks play once, then everything is still; with
    reduced motion it just appears. */
export default function DayDone({ done, focusedMin, streak, moves, onPlan, onClose }: {
  done: number; focusedMin: number; streak: number; moves: GoalMove[]
  onPlan: () => void; onClose: () => void
}) {
  const { t } = useLang()
  useEscape(onClose)
  return (
    <div className="dd-backdrop" onClick={onClose}>
      <div className="dd-card" role="dialog" aria-modal="true" aria-labelledby="dd-title" onClick={(e) => e.stopPropagation()}>
        <div className="dd-burst" aria-hidden>
          <svg viewBox="0 0 120 120">
            <defs>
              <linearGradient id="dd-ring" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--neon-a, var(--accent-bright))" />
                <stop offset="0.55" stopColor="var(--neon-b, var(--accent))" />
                <stop offset="1" stopColor="var(--ok)" />
              </linearGradient>
            </defs>
            <circle className="dd-track" cx="60" cy="60" r="50" />
            <circle className="dd-ring" cx="60" cy="60" r="50" pathLength={1} />
          </svg>
          {Array.from({ length: SPARKS }, (_, i) => (
            <i key={i} className="dd-spark" style={{ ['--a' as string]: `${(360 / SPARKS) * i}deg`, ['--d' as string]: `${i % 3}` }} />
          ))}
          <span className="dd-check">✓</span>
        </div>
        <h2 id="dd-title" className="dd-title">{t('dd.title')}</h2>
        <p className="dd-sub">{t(done === 1 ? 'dd.sub1' : 'dd.sub', { n: done })}</p>
        <div className="dd-stats">
          <div><b className="num">{done}</b><span>{t(done === 1 ? 'dd.task' : 'dd.tasks')}</span></div>
          <div><b className="num">{focusedMin > 0 ? hm(focusedMin / 60) : '—'}</b><span>{t('dd.focused')}</span></div>
          <div className="dd-fire"><b className="num"><Icon name="flame" size={18} strokeWidth={2.1} className="dd-flame" /> {streak}</b><span>{t('streak.label')}</span></div>
        </div>
        {moves.length > 0 && (
          <div className="dd-moves">
            <div className="dd-moves-h">{t('dd.moved')}</div>
            {moves.slice(0, 3).map((m) => (
              <div className="dd-move" key={m.id}>
                <span className="dd-move-t">{m.title}</span>
                <span className="num">{m.from}% → <b>{m.to}%</b></span>
              </div>
            ))}
          </div>
        )}
        <div className="dd-actions">
          <button type="button" className="btn btn-primary" onClick={onPlan}>{t('ptm.title')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  )
}
