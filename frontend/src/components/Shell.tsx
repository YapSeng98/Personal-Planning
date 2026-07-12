import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { onSyncState, type SyncState } from '../sync/engine'
import QuickAdd from './QuickAdd'

const links = [
  { to: '/', label: 'Today', ico: '☀️' },
  { to: '/plan', label: 'Plan', ico: '🗓️' },
  { to: '/goals', label: 'Goals', ico: '🎯' },
  { to: '/reviews', label: 'Review', ico: '✍️' },
]

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
        <span className={`sync-dot ${sync}`}><i />{stateLabel[sync]}</span>
      </nav>
      <main className="shell-main">
        <Outlet />
      </main>
      <nav className="nav-bottom" aria-label="Main">
        {nav('').slice(0, 2)}
        <button className="fab" aria-label="Quick add" onClick={() => setAdding(true)}>+</button>
        {nav('').slice(2)}
      </nav>
      <button className="fab fab-desktop" aria-label="Quick add" onClick={() => setAdding(true)}>+</button>
      {adding && <QuickAdd onClose={() => setAdding(false)} />}
    </div>
  )
}
