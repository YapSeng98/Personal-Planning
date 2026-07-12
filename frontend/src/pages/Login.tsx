import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../sync/api'
import { seedIfEmpty } from '../db/seed'
import { syncNow } from '../sync/engine'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await login(username, password)
      syncNow()
      nav('/')
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Sign-in failed.')
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
      <form className="login-card" onSubmit={signIn}>
        <img className="logo" src={`${import.meta.env.BASE_URL}icon.svg`} alt="" />
        <h1 className="grad-text">Planner</h1>
        <p className="tagline">Plan the year. Win the day.</p>
        <p className="sub">Your daily tasks roll up to your yearly goals — synced to dev405150.service-now.com.</p>
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
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <div className="err" role="alert">{err}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy || !username || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="divider">or</div>
        <button className="btn" type="button" onClick={tryOffline}>
          Explore offline with sample data
        </button>
      </form>
    </div>
  )
}
