import { useEffect, useState } from 'react'
import { db } from '../db/db'
import { isAuthed, currentUser, clearTokens, serverLogout } from '../sync/api'
import { syncNow, onSyncState, type SyncState } from '../sync/engine'
import { getTheme, setTheme, type Theme } from '../lib/theme'
import { useLang, LANGS, type Lang } from '../lib/i18n'

export default function Settings() {
  const [theme, setThemeState] = useState<Theme>(getTheme())
  const [sync, setSync] = useState<SyncState>('idle')
  const [pending, setPending] = useState(0)
  const { t, lang, setLang } = useLang()
  const offlineMode = localStorage.getItem('offline_mode') === '1' && !isAuthed()

  const themes: { value: Theme; label: string; hint: string }[] = [
    { value: 'system', label: t('set.themeSystem'), hint: t('set.themeSystemHint') },
    { value: 'light', label: t('set.themeLight'), hint: t('set.themeLightHint') },
    { value: 'dark', label: t('set.themeDark'), hint: t('set.themeDarkHint') },
  ]
  const stateLabel: Record<SyncState, string> = {
    idle: t('set.syncIdle'), syncing: t('set.syncSyncing'), offline: t('set.syncOffline'),
    'local-only': t('set.syncLocal'), error: t('set.syncError'),
  }

  useEffect(() => {
    const off = onSyncState(setSync)
    db.outbox.count().then(setPending)
    return off
  }, [])

  function pick(th: Theme) {
    setTheme(th)
    setThemeState(th)
  }

  async function logout() {
    const unsynced = await db.outbox.count()
    const msg = unsynced > 0
      ? t(unsynced === 1 ? 'set.logoutUnsynced' : 'set.logoutUnsyncedPlural', { n: unsynced })
      : offlineMode ? t('set.exitConfirm') : t('set.logoutConfirm')
    if (!window.confirm(msg)) return
    if (isAuthed()) await serverLogout()
    clearTokens()
    localStorage.removeItem('offline_mode')
    localStorage.removeItem('planner_user')
    await db.delete()
    window.location.hash = '#/login'
    window.location.reload()
  }

  return (
    <div>
      <div className="greet">
        <h1>{t('set.title')}</h1>
        <div className="sub">{t('set.sub')}</div>
      </div>

      <div className="section-h">{t('set.appearance')}</div>
      <div className="card">
        <div className="seg" role="radiogroup" aria-label={t('set.appearance')}>
          {themes.map((th) => (
            <button
              key={th.value}
              role="radio"
              aria-checked={theme === th.value}
              className={`seg-btn ${theme === th.value ? 'on' : ''}`}
              onClick={() => pick(th.value)}
            >
              <b>{th.label}</b>
              <span>{th.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="section-h">{t('set.language')}</div>
      <div className="card">
        <div className="seg" role="radiogroup" aria-label={t('set.language')}>
          {LANGS.map((l) => (
            <button
              key={l.value}
              role="radio"
              aria-checked={lang === l.value}
              className={`seg-btn ${lang === l.value ? 'on' : ''}`}
              onClick={() => setLang(l.value as Lang)}
            >
              <b>{l.native}</b>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="section-h">{t('set.account')}</div>
      <div className="card settings-row">
        <div>
          <b>{offlineMode ? t('set.offlineDemo') : currentUser() ?? '—'}</b>
          <div className="row-sub">{offlineMode ? t('set.demoDesc') : t('set.signedInAs')}</div>
        </div>
        <button className="btn btn-danger-soft" onClick={logout}>
          {offlineMode ? t('set.exitDemo') : t('set.logout')}
        </button>
      </div>

      <div className="section-h">{t('set.sync')}</div>
      <div className="card settings-row">
        <div>
          <b><span className={`sync-dot ${sync}`}><i /></span> {stateLabel[sync]}</b>
          <div className="row-sub">
            {pending > 0 ? t(pending === 1 ? 'set.pending' : 'set.pendingPlural', { n: pending }) : t('set.allSaved')}
          </div>
        </div>
        {!offlineMode && <button className="btn" onClick={() => syncNow()}>{t('set.syncNow')}</button>}
      </div>

      <p className="about-line">{t('set.about')}</p>
    </div>
  )
}
