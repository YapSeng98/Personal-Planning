import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { onSyncState, type SyncState } from '../sync/engine'
import TaskForm from './TaskForm'

const links = [
  { to: '/', label: 'Today', ico: '☀️' },
  { to: '/plan', label: 'Plan', ico: '🗓️' },
  { to: '/goals', label: 'Goals', ico: '🎯' },
  { to: '/reviews', label: 'Review', ico: '✍️' },
  { to: '/analytics', label: 'Stats', ico: '📊' },
]

/** Anywhere in the app can request the quick-add sheet. */
export const openQuickAdd = () => window.dispatchEvent(new CustomEvent('planner:quickadd'))

const stateLabel: Record<SyncState, string> = {
  idle: 'Synced',
  syncing: 'Syncing…',
  offline: 'Offline — changes queued',
  'local-only': 'Local only',
  error: 'Sync error — retrying',
}

export default function Shell() {
  const [adding, setAdding] = useState(false)
  const [sync, setSync] = useState<SyncState>('idle')
  useEffect(() => onSyncState(setSync), [])
  useEffect(() => {
    const open = () => setAdding(true)
    window.addEventListener('planner:quickadd', open)
    return () => window.removeEventListener('planner:quickadd', open)
  }, [])

  const nav = (cls: string) =>
    links.map((l) => (
      <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''} ${cls}`}>
        <span className="ico" aria-hidden>{l.ico}</span>
        <span>{l.label}</span>
      </NavLink>
    ))

  return (
    <div className="shell">
      <nav className="nav-rail" aria-label="Main">
        <div className="brand grad-text">Planner</div>
        {nav('')}
        <div style={{ flex: 1 }} />
        <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <span className="ico" aria-hidden>⚙️</span>
          <span>Settings</span>
        </NavLink>
        <NavLink to="/settings" className="sync-link" title="Sync status — open settings">
          <span className={`sync-dot ${sync}`}><i />{stateLabel[sync]}</span>
        </NavLink>
      </nav>
      <main className="shell-main">
        <Outlet />
      </main>
      <nav className="nav-bottom" aria-label="Main">
        {nav('')}
      </nav>
      <button className="fab fab-desktop" aria-label="Add task" onClick={() => setAdding(true)}>+</button>
      <button className="fab fab-float" aria-label="Add task" onClick={() => setAdding(true)}>+</button>
      <NavLink to="/settings" className="gear-mobile" aria-label="Settings">⚙️</NavLink>
      {adding && <TaskForm task={null} onClose={() => setAdding(false)} />}
    </div>
  )
}
