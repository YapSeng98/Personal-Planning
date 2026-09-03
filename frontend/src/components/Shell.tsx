import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { onSyncState, type SyncState } from '../sync/engine'
import { useLang } from '../lib/i18n'
import { type Task } from '../db/db'
import TaskForm from './TaskForm'
import SearchModal from './SearchModal'
import { VideoProvider } from './VideoPlayer'

const links = [
  { to: '/', key: 'nav.today', ico: '☀️' },
  { to: '/plan', key: 'nav.plan', ico: '🗓️' },
  { to: '/board', key: 'nav.board', ico: '🗂️' },
  { to: '/goals', key: 'nav.goals', ico: '🎯' },
  { to: '/reviews', key: 'nav.reviews', ico: '✍️' },
  { to: '/sketches', key: 'nav.sketches', ico: '🎨' },
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
  const [searching, setSearching] = useState(false)
  const [searchTask, setSearchTask] = useState<Task | null>(null)
  const [sync, setSync] = useState<SyncState>('idle')
  const { t } = useLang()
  useEffect(() => onSyncState(setSync), [])
  useEffect(() => {
    const open = () => setAdding(true)
    window.addEventListener('planner:quickadd', open)
    return () => window.removeEventListener('planner:quickadd', open)
  }, [])
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearching(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const nav = (cls: string) =>
    links.map((l) => (
      <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''} ${cls}`}>
        <span className="ico" aria-hidden>{l.ico}</span>
        <span>{t(l.key)}</span>
      </NavLink>
    ))

  return (
    <VideoProvider>
    <div className="shell">
      <nav className="nav-rail" aria-label="Main">
        <div className="nav-rail-top">
          <div className="brand grad-text">{t('brand')}</div>
          <button className="nav-search-btn" onClick={() => setSearching(true)} aria-label={t('search.trigger')} title={t('search.trigger')}>🔍</button>
        </div>
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
      <button className="search-mobile" onClick={() => setSearching(true)} aria-label={t('search.trigger')}>🔍</button>
      {adding && <TaskForm task={null} onClose={() => setAdding(false)} />}
      {searching && (
        <SearchModal
          onClose={() => setSearching(false)}
          onOpenTask={(task) => setSearchTask(task)}
        />
      )}
      {searchTask && <TaskForm task={searchTask} onClose={() => setSearchTask(null)} />}
    </div>
    </VideoProvider>
  )
}
