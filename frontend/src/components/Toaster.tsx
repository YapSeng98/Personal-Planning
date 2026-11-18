import { useEffect, useRef, useState } from 'react'
import { TOAST, type Toast } from '../lib/toast'
import { useLang } from '../lib/i18n'
import Icon from './Icon'

/** The bottom-of-screen message (lib/toast.ts). Goals that moved show their
    bars sliding from the old progress to the new — a finished task's effect
    on the week, the quarter and the year at once. */
export default function Toaster() {
  const [toast, setToast] = useState<(Toast & { n: number }) | null>(null)
  const [grown, setGrown] = useState(false)
  const timer = useRef(0)
  const { t } = useLang()

  useEffect(() => {
    let n = 0
    const on = (e: Event) => {
      const next = (e as CustomEvent<Toast>).detail
      window.clearTimeout(timer.current)
      setGrown(false)
      setToast({ ...next, n: ++n })
      timer.current = window.setTimeout(() => setToast(null), next.kind === 'goals' ? 5000 : 6000)
    }
    window.addEventListener(TOAST, on)
    return () => { window.removeEventListener(TOAST, on); window.clearTimeout(timer.current) }
  }, [])
  // the bars start at the old progress and move to the new one a moment after showing
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setGrown(true), 280)
    return () => window.clearTimeout(id)
  }, [toast])

  const close = () => { window.clearTimeout(timer.current); setToast(null) }
  if (!toast) return null
  return (
    <div className="toast-wrap">
      <div className={`toast toast-${toast.kind}`} key={toast.n} role="status" aria-live="polite">
        {toast.kind === 'goals' ? (
          <>
          <span className="tg-badge" aria-hidden>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16l5-5 4 4 7-7" /><path d="M15 8h5v5" /></svg>
          </span>
          <div className="tg-list">
            {toast.moves.slice(0, 3).map((m, i) => (
              <div className={`tg-row ${i ? 'up' : ''}`} key={m.id}>
                <div className="tg-top">
                  <span className="tg-lvl">{t(`gtype.${m.type}`)}</span>
                  <span className="tg-t">{m.title}</span>
                </div>
                <div className="tg-line">
                  <div className="tg-bar" aria-hidden>
                    <i style={{ transform: `scaleX(${(grown ? m.to : m.from) / 100})` }} />
                  </div>
                  <span className="tg-pct num">{m.from}% → <b>{m.to}%</b></span>
                </div>
              </div>
            ))}
          </div>
          </>
        ) : (
          <>
            <span className="toast-text">{toast.text}</span>
            {toast.action && (
              <button type="button" className="toast-act" onClick={() => { toast.action!.run(); close() }}>{toast.action.label}</button>
            )}
          </>
        )}
        <button type="button" className="toast-x" onClick={close} aria-label={t('common.close')}><Icon name="close" size={14} /></button>
      </div>
    </div>
  )
}
