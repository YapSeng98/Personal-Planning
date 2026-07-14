import { useEffect, useState } from 'react'
import { db } from '../db/db'
import { isAuthed, currentUser, clearTokens, serverLogout } from '../sync/api'
import { syncNow, onSyncState, type SyncState } from '../sync/engine'
import { getTheme, setTheme, type Theme } from '../lib/theme'

const THEMES: { value: Theme; label: string; hint: string }[] = [
  { value: 'system', label: 'System', hint: 'follow device' },
  { value: 'light', label: 'Light', hint: 'warm paper' },
  { value: 'dark', label: 'Dark', hint: 'deep night' },
]

const stateLabel: Record<SyncState, string> = {
  idle: 'Synced with ServiceNow',
  syncing: 'Syncing…',
  offline: 'Offline — changes queued locally',
  'local-only': 'Local only — not signed in to sync',
  error: 'Sync error — retrying automatically',
}

export default function Settings() {
  const [theme, setThemeState] = useState<Theme>(getTheme())
  const [sync, setSync] = useState<SyncState>('idle')
  const [pending, setPending] = useState(0)
  const offlineMode = localStorage.getItem('offline_mode') === '1' && !isAuthed()

  useEffect(() => {
    const off = onSyncState(setSync)
    db.outbox.count().then(setPending)
    return off
  }, [])

  function pick(t: Theme) {
    setTheme(t)
    setThemeState(t)
  }

  async function logout() {
    const unsynced = await db.outbox.count()
    const msg = unsynced > 0
      ? `You have ${unsynced} change${unsynced === 1 ? '' : 's'} not yet synced — they will be lost. Log out anyway?`
      : offlineMode
        ? 'Exit demo mode? Local demo data will be cleared.'
        : 'Log out? Local data is cleared; it syncs back next time you sign in.'
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
        <h1>Settings</h1>
        <div className="sub">Appearance, account, and sync.</div>
      </div>

      <div className="section-h">Appearance</div>
      <div className="card">
        <div className="seg" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => (
            <button
              key={t.value}
              role="radio"
              aria-checked={theme === t.value}
              className={`seg-btn ${theme === t.value ? 'on' : ''}`}
              onClick={() => pick(t.value)}
            >
              <b>{t.label}</b>
              <span>{t.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="section-h">Account</div>
      <div className="card settings-row">
        <div>
          <b>{offlineMode ? 'Offline demo' : currentUser() ?? 'Signed in'}</b>
          <div className="row-sub">
            {offlineMode
              ? 'Exploring with sample data — nothing leaves this device.'
              : 'Signed in to dev405150.service-now.com'}
          </div>
        </div>
        <button className="btn btn-danger-soft" onClick={logout}>
          {offlineMode ? 'Exit demo' : 'Log out'}
        </button>
      </div>

      <div className="section-h">Sync</div>
      <div className="card settings-row">
        <div>
          <b><span className={`sync-dot ${sync}`}><i /></span> {stateLabel[sync]}</b>
          <div className="row-sub">
            {pending > 0 ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync` : 'Everything saved'}
          </div>
        </div>
        {!offlineMode && (
          <button className="btn" onClick={() => syncNow()}>Sync now</button>
        )}
      </div>

      <p className="about-line">Planner · offline-first · your data lives in your own ServiceNow instance</p>
    </div>
  )
}
