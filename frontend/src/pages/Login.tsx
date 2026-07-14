import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, register } from '../sync/api'
import { seedIfEmpty } from '../db/seed'
import { syncNow } from '../sync/engine'

export default function Login() {
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

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
      setErr(ex instanceof Error ? ex.message : 'Something went wrong — try again.')
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
        <h1 className="grad-text">Planner</h1>
        <p className="tagline">Plan the year. Win the day.</p>
        <p className="sub">
          {mode === 'signin'
            ? 'Daily tasks roll up to yearly goals — synced to your ServiceNow instance.'
            : 'Pick any username and password (8+ characters) — your account lives in your own instance.'}
        </p>
        <input
          type="text"
          placeholder="Username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
          {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <button
          className="btn"
          type="button"
          onClick={() => {
            setMode(mode === 'signin' ? 'register' : 'signin')
            setErr('')
          }}
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
        <div className="divider">or</div>
        <button className="btn" type="button" onClick={tryOffline}>
          Explore offline with sample data
        </button>
      </form>
    </div>
  )
}
