import { useState } from 'react'
import { useLang } from '../lib/i18n'
import { useEscape } from '../lib/escape'
import { applyRestore, type RestorePlan } from '../lib/backup'

const KEYS = ['tasks', 'goals', 'habits', 'habitLogs', 'projects', 'sketches', 'folders', 'reviews'] as const

/** What a backup would bring back, and the button that does it. Nothing
    that's here now is changed — only what's missing comes back. */
export default function RestoreSheet({ plan, me, onClose }: { plan: RestorePlan; me?: string | null; onClose: () => void }) {
  const { t, lang } = useLang()
  const [state, setState] = useState<{ step: 'ready' | 'going' | 'done' | 'err'; done: number; msg?: string }>({ step: 'ready', done: 0 })
  const going = state.step === 'going'
  useEscape(() => { if (!going) onClose() })
  const n = plan.rows.length
  const made = plan.exportedAt ? new Date(plan.exportedAt).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
  const otherAccount = !!plan.account && !!me && plan.account !== me

  async function go() {
    setState({ step: 'going', done: 0 })
    try {
      const done = await applyRestore(plan, (d) => setState({ step: 'going', done: d }))
      setState({ step: 'done', done })
    } catch (e) {
      setState({ step: 'err', done: 0, msg: e instanceof Error ? e.message : String(e) })
    }
  }

  return (
    <div className="sheet-backdrop" onClick={() => { if (!going) onClose() }}>
      <div className="sheet restore-sheet" role="dialog" aria-modal="true" aria-label={t('restore.title')} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
        <h2>{t('restore.title')}</h2>
        <p className="row-sub">{plan.account ? t('restore.fromAcct', { date: made, account: plan.account }) : t('restore.from', { date: made })}</p>
        {otherAccount && <div className="ai-status err">{t('restore.otherAcct', { account: plan.account!, me: me! })}</div>}
        {n > 0 ? (
          <>
            <div className="fl">{t('restore.bring')}</div>
            <div className="restore-counts">
              {KEYS.filter((k) => plan.bring[k]).map((k) => (
                <div key={k} className="restore-count"><span>{t(`restore.k.${k}`)}</span><b className="num">{plan.bring[k]}</b></div>
              ))}
            </div>
          </>
        ) : (
          <p>{t('restore.nothing')}</p>
        )}
        {plan.already > 0 && <p className="row-sub">{t('restore.already', { n: plan.already })}</p>}
        {plan.skipped > 0 && <p className="row-sub">{t('restore.skipped', { n: plan.skipped })}</p>}
        {state.step === 'going' && <div className="ai-status" role="status">{t('restore.going', { done: state.done, n })}</div>}
        {state.step === 'done' && <div className="ai-status ok" role="status">✓ {t('restore.done', { n: state.done })}</div>}
        {state.step === 'err' && <div className="ai-status err" role="alert">✕ {state.msg}</div>}
        </div>
        <div className="row sheet-actions" style={{ justifyContent: 'flex-end', gap: '0.6rem' }}>
          {state.step === 'done' || n === 0
            ? <button type="button" className="btn btn-primary" onClick={onClose}>{t('common.close')}</button>
            : <>
                <button type="button" className="btn" onClick={onClose} disabled={going}>{t('common.cancel')}</button>
                <button type="button" className="btn btn-primary" onClick={go} disabled={going}>{t('restore.go', { n })}</button>
              </>}
        </div>
      </div>
    </div>
  )
}
