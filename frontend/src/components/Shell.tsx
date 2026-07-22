import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { onSyncState, type SyncState } from '../sync/engine'
import { useLang } from '../lib/i18n'
import TaskForm from './TaskForm'

const links = [
  { to: '/', key: 'nav.today', ico: '☀️' },
  { to: '/plan', key: 'nav.plan', ico: '🗓️' },
  { to: '/board', key: 'nav.board', ico: '🗂️' },
  { to: '/goals', key: 'nav.goals', ico: '🎯' },
  { to: '/reviews', key: 'nav.reviews', ico: '✍️' },
  { to: '/analytics', key: 'nav.stats', ico: '📊' },
]

/** Anywhere in the app can request the quick-add sheet. */
export const openQuickAdd = () => window.dispatchEvent(new CustomEvent('planner:quickadd'))

const syncKey: Record<SyncState, string> = {
  idle: 'sync.idle', syncing: 'sync.syncing', offline: 'sync.offline',
  'local-only': 'sync.local', error: 'sync.error',
}

export default function Shell() {
  const [adding, setAdding] = useState(false)
  const [sync, setSync] = useState<SyncState>('idle')
  const { t } = useLang()
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
        <span>{t(l.key)}</span>
      </NavLink>
    ))

  return (
    <div className="shell">
      <nav className="nav-rail" aria-label="Main">
        <div className="brand grad-text">{t('brand')}</div>
        {nav('')}
        <div style={{ flex: 1 }} />
        <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <span className="ico" aria-hidden>⚙️</span>
          <span>{t('nav.settings')}</span>
        </NavLink>
        <NavLink to="/settings" className="sync-link" title="Sync status — open settings">
          <span className={`sync-dot ${sync}`}><i />{t(syncKey[sync])}</span>
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
