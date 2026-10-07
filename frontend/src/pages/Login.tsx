import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { login, register, localDataOwner, setLocalDataOwner } from '../sync/api'
import { db, discardUntouchedDemoData } from '../db/db'
import { seedIfEmpty } from '../db/seed'
import { syncNow } from '../sync/engine'
import { useLang } from '../lib/i18n'

export default function Login() {
  const [params] = useSearchParams()
  // this device has an account's data and its sign-in ended (App.tsx)
  const signedOut = params.get('signedout') === '1'
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  // (installs from before the username was remembered: the name shown in
  // the app, which is the username unless a display name was chosen)
  const [username, setUsername] = useState(() => (signedOut ? localStorage.getItem('planner_login') ?? localStorage.getItem('planner_user') ?? '' : ''))
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const { t } = useLang()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      // the offline demo was running here (its sample data isn't the account's)
      const wasDemo = localStorage.getItem('offline_mode') === '1'
      const res = mode === 'register' ? await register(username, password) : await login(username, password)
      const uid = res.user?.id
      // Signed in: never the demo again on this device — a leftover demo flag
      // used to keep it "local only" (not syncing) once its sign-in ended.
      localStorage.removeItem('offline_mode')
      localStorage.setItem('planner_login', username.trim())
      if (wasDemo) await discardUntouchedDemoData()
      // Data left on this device by a different account (its session ended
      // without a log out) is cleared first — it must never show here, nor
      // its unsynced changes be pushed into this account.
      const prev = localDataOwner()
      if (uid && prev && prev !== uid) {
        // Clear every table (not db.delete(), which waits on the app's own
        // open connection and can hang) — outbox and sync cursor included.
        await db.transaction('rw', db.tables, async () => { await Promise.all(db.tables.map((tb) => tb.clear())) })
        setLocalDataOwner(uid)
        // Fresh start for the new account (its own live-sync channel, sync
        // cursor…). Set the hash first: it applies at once, so the reload
        // lands on Today rather than reloading the login screen.
        window.location.hash = '#/'
        window.location.reload()
        return
      }
      if (uid) setLocalDataOwner(uid)
      syncNow()
      nav('/')
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : t('login.failed'))
    } finally {
      setBusy(false)
    }
  }

  async function tryOffline() {
    await seedIfEmpty()
    localStorage.setItem('offline_mode', '1')
    nav('/')
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img className="logo" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        <h1 className="grad-text">{t('brand')}</h1>
        <p className="tagline">{t('login.tagline')}</p>
        <p className="sub">{mode === 'signin' ? t('login.subSignin') : t('login.subRegister')}</p>
        {signedOut && <p className="login-note" role="status">{t('login.signedOut')}</p>}
        <input
          type="text"
          placeholder={t('login.username')}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder={t('login.password')}
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
          {busy ? t('login.working') : mode === 'signin' ? t('login.signin') : t('login.create')}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'register' : 'signin')
            setErr('')
          }}
        >
          {mode === 'signin' ? t('login.toRegister') : t('login.toSignin')}
        </button>
        {/* not offered on a device that has an account's data: it's signing back in */}
        {!signedOut && (
          <>
            <div className="divider">{t('login.or')}</div>
            <button className="btn" type="button" onClick={tryOffline}>
              {t('login.offline')}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
