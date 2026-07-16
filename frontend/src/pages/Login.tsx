import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, register } from '../sync/api'
import { seedIfEmpty } from '../db/seed'
import { syncNow } from '../sync/engine'
import { useLang } from '../lib/i18n'

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [username, setUsername] = useState('')
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
      if (mode === 'register') await register(username, password)
      else await login(username, password)
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
        <div className="divider">{t('login.or')}</div>
        <button className="btn" type="button" onClick={tryOffline}>
          {t('login.offline')}
        </button>
      </form>
    </div>
  )
}
