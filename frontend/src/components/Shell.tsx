import { NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { onSyncState, type SyncState } from '../sync/engine'
import { useLang } from '../lib/i18n'
import { type Task } from '../db/db'
import TaskForm from './TaskForm'
import SearchModal from './SearchModal'
import { VideoProvider } from './VideoPlayer'
import AppWindow from './AppWindow'
import Icon, { type IconName } from './Icon'
import { updateReady, onUpdateReady, applyUpdate } from '../lib/pwaUpdate'
import { useRunningTimer, useElapsed, stopTimer, clock, type RunningTimer } from '../lib/timer'
import { useFocus, openFocus, nextRound, endFocus, roundElapsed, remaining, type Focus } from '../lib/focus'
import FocusMode from './FocusMode'
import Toaster from './Toaster'
import PageGuard from './PageGuard'
import { reminderPrefs, reminderBody, type Reminder } from '../lib/reminders'

const links: { to: string; key: string; ico: IconName }[] = [
  { to: '/', key: 'nav.today', ico: 'today' },
  { to: '/plan', key: 'nav.plan', ico: 'plan' },
  { to: '/board', key: 'nav.board', ico: 'board' },
  { to: '/goals', key: 'nav.goals', ico: 'goals' },
  { to: '/reviews', key: 'nav.reviews', ico: 'reviews' },
  { to: '/sketches', key: 'nav.sketches', ico: 'sketches' },
  { to: '/analytics', key: 'nav.stats', ico: 'stats' },
]

/** Anywhere in the app can request the quick-add sheet. */
export const openQuickAdd = () => window.dispatchEvent(new CustomEvent('planner:quickadd'))

/** The task being timed — or in focus mode, its round or break — on every
    screen. Tap it to open the focus screen; Stop saves the time. */
function TimerBar({ timer, focus }: { timer: RunningTimer | null; focus: Focus | null }) {
  const sec = useElapsed(timer?.startedAt ?? (focus ? 0 : undefined))
  const { t } = useLang()
  const title = focus?.title ?? timer?.title ?? ''
  let readout = clock(sec)
  if (focus) {
    if (focus.phase === 'ready') readout = t('focus.ready', { round: focus.round })
    else if (focus.plan === 'free') readout = clock(Math.floor(roundElapsed(focus) / 1000))
    else readout = `${focus.phase === 'break' ? t('focus.break') + ' ' : ''}${clock(Math.ceil(remaining(focus) / 1000))}`
    if (focus.paused) readout += ` · ${t('focus.paused')}`
  }
  return (
    <div className={`timer-bar ${focus?.phase === 'break' ? 'is-break' : ''}`} role="status">
      <span className="tb-pulse" aria-hidden />
      <button type="button" className="tb-open" onClick={() => openFocus()} aria-label={t('focus.openFor', { title })}>
        <Icon name="timer" size={16} />
        <span className="tb-title">{title}</span>
        <span className="tb-clock num">{readout}</span>
      </button>
      {focus?.phase === 'ready'
        ? <button type="button" className="btn btn-primary" onClick={() => { nextRound(); openFocus() }}>{t('focus.startRound', { round: focus.round })}</button>
        : <button type="button" className="btn btn-primary" onClick={() => endFocus().then(() => stopTimer())}>{t('timer.stop')}</button>}
    </div>
  )
}

interface Shown {
  tag: string
  title: string
  body: string
  taskId?: string
}

/** A time block starting while you're in the app (lib/reminders.ts), or a
    push that arrived meanwhile: a banner, with the timer one tap away. */
function ReminderBanners() {
  const [items, setItems] = useState<Shown[]>([])
  const { t } = useLang()
  useEffect(() => {
    const add = (x: Shown) => {
      setItems((l) => (l.some((y) => y.tag === x.tag) ? l : [...l, x]))
      // gone by itself after a quarter of an hour
      window.setTimeout(() => setItems((l) => l.filter((y) => y.tag !== x.tag)), 15 * 60_000)
    }
    const onLocal = (e: Event) => {
      const r = (e as CustomEvent<Reminder>).detail
      add({ tag: r.tag, title: r.title, body: reminderBody(r, reminderPrefs().lead), taskId: r.taskId })
    }
    const onPush = (e: MessageEvent) => {
      const d = e.data as { type?: string; tag?: string; title?: string; body?: string } | null
      if (d?.type === 'planner:reminder' && d.tag) add({ tag: d.tag, title: d.title ?? '', body: d.body ?? '' })
    }
    window.addEventListener('planner:reminder', onLocal)
    navigator.serviceWorker?.addEventListener('message', onPush)
    return () => {
      window.removeEventListener('planner:reminder', onLocal)
      navigator.serviceWorker?.removeEventListener('message', onPush)
    }
  }, [])
  const close = (tag: string) => setItems((l) => l.filter((y) => y.tag !== tag))
  if (!items.length) return null
  return (
    <div className="rem-stack">
      {items.map((x) => (
        <div key={x.tag} className="rem-banner" role="alert">
          <span className="rem-bell" aria-hidden>⏰</span>
          <div className="rem-text">
            <b>{x.title}</b>
            <span className="num">{x.body}</span>
          </div>
          {x.taskId && (
            <button type="button" className="btn btn-primary" onClick={() => { openFocus({ id: x.taskId!, title: x.title }); close(x.tag) }}>
              {t('rem.startTimer')}
            </button>
          )}
          <button type="button" className="rem-x" onClick={() => close(x.tag)} aria-label={t('common.close')}><Icon name="close" size={14} /></button>
        </div>
      ))}
    </div>
  )
}

/** Where each page was scrolled to, for going back to it. */
const scrollMemory = new Map<string, number>()

/** A page opens at its top (it used to open where the previous page was
    scrolled to — half-way down, under the corner buttons on a phone); going
    back returns to where you were on it. */
function usePageScroll() {
  const { pathname } = useLocation()
  const navType = useNavigationType()
  const current = useRef(pathname)
  useEffect(() => {
    let raf = 0
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => scrollMemory.set(current.current, window.scrollY)) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', onScroll) }
  }, [])
  useLayoutEffect(() => {
    if (current.current === pathname) return
    current.current = pathname
    const saved = navType === 'POP' ? scrollMemory.get(pathname) : undefined
    if (saved === undefined) {
      window.scrollTo(0, 0)
      return
    }
    // the page's content loads from the database a moment later: try again as it grows
    const timers = [0, 80, 250, 600].map((ms) => window.setTimeout(() => window.scrollTo(0, saved), ms))
    return () => timers.forEach((id) => window.clearTimeout(id))
  }, [pathname, navType])
}

const syncKey: Record<SyncState, string> = {
  idle: 'sync.idle', syncing: 'sync.syncing', offline: 'sync.offline',
  'local-only': 'sync.local', error: 'sync.error', 'signed-out': 'sync.signedOut', 'other-account': 'sync.otherAccount',
}

export default function Shell() {
  const [adding, setAdding] = useState(false)
  const [searching, setSearching] = useState(false)
  const [searchTask, setSearchTask] = useState<Task | null>(null)
  const [sync, setSync] = useState<SyncState>('idle')
  const [hasUpdate, setHasUpdate] = useState(updateReady())
  const timer = useRunningTimer()
  const focus = useFocus()
  const { t } = useLang()
  usePageScroll()
  useEffect(() => onSyncState(setSync), [])
  useEffect(() => onUpdateReady(() => setHasUpdate(true)), [])
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
        return
      }
      // N: new task — unless typing somewhere, or a sheet is already open
      const el = e.target as HTMLElement | null
      const typing = !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))
      if (e.key.toLowerCase() === 'n' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing && !document.querySelector('.sheet-backdrop')) {
        e.preventDefault()
        setAdding(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Phones: scrolling down, the floating tab bar shrinks to the page you're
  // on (as on iOS 26); scrolling up or tapping it brings it back.
  const [compact, setCompact] = useState(false)
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  // the app icon's "New task" shortcut (manifest) arrives as ?add=1
  useEffect(() => {
    if (!new URLSearchParams(search).has('add')) return
    setAdding(true)
    navigate(pathname, { replace: true })
  }, [search, pathname, navigate])
  useEffect(() => {
    let last = window.scrollY
    // only scrolling you do shrinks it — not the app putting a page back
    // where you left it (Back), which would leave your next tap opening
    // the bar instead of the page you tapped
    let gesture = 0
    const mark = () => { gesture = Date.now() }
    const onScroll = () => {
      const y = window.scrollY
      const yours = Date.now() - gesture < 800
      if (yours && y > last + 8 && y > 120) setCompact(true)
      else if (y < last - 8 || y < 60) setCompact(false)
      last = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('touchmove', mark, { passive: true })
    window.addEventListener('wheel', mark, { passive: true })
    window.addEventListener('keydown', mark)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('touchmove', mark)
      window.removeEventListener('wheel', mark)
      window.removeEventListener('keydown', mark)
    }
  }, [])
  useEffect(() => setCompact(false), [pathname])

  const nav = (cls: string) =>
    links.map((l) => (
      <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''} ${cls}`}>
        <span className="ico" aria-hidden><Icon name={l.ico} /></span>
        <span>{t(l.key)}</span>
      </NavLink>
    ))

  return (
    <VideoProvider>
    <div className="shell">
      {/* the sky behind the glass in Nebula (a ringed planet, moons in orbit),
          Galaxy (a turning spiral galaxy) and Moon (a white moon), meteors now
          and then — sky.css; hidden in the other looks */}
      <div className="sky" aria-hidden>
        <div className="sky-stars s1" /><div className="sky-stars s2" /><div className="sky-beam" />
        <i className="sky-meteor m1" /><i className="sky-meteor m2" /><i className="sky-meteor m3" />
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => <i key={n} className={`sky-tw t${n}`} />)}
        {[1, 2, 3, 4, 5].map((n) => <i key={n} className={`sky-rock k${n}`}><i className="rk-body"><i className="rk-shade" /></i></i>)}
        <div className="sky-astro"><div className="sky-astro-y"><div className="sky-astro-z"><div className="sky-astro-spin">
          <svg viewBox="0 0 120 150" width="100%" height="100%">
            <defs>
              <linearGradient id="as-suit" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="0.6" stopColor="#dfe3ec" /><stop offset="1" stopColor="#9aa1b3" /></linearGradient>
              <radialGradient id="as-visor" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stopColor="#5b6cff" /><stop offset="0.45" stopColor="#1a1f4d" /><stop offset="1" stopColor="#05060f" /></radialGradient>
            </defs>
            <rect x="30" y="54" width="60" height="58" rx="16" fill="#b9bfcc" />
            <rect x="18" y="66" width="18" height="40" rx="9" fill="url(#as-suit)" transform="rotate(28 27 70)" />
            <rect x="84" y="62" width="18" height="40" rx="9" fill="url(#as-suit)" transform="rotate(-38 93 66)" />
            <rect x="38" y="104" width="18" height="38" rx="9" fill="url(#as-suit)" transform="rotate(10 47 108)" />
            <rect x="64" y="104" width="18" height="38" rx="9" fill="url(#as-suit)" transform="rotate(-14 73 108)" />
            <rect x="34" y="58" width="52" height="56" rx="18" fill="url(#as-suit)" />
            <rect x="46" y="74" width="28" height="16" rx="4" fill="#cfd5e2" />
            <circle cx="53" cy="82" r="2.6" fill="#3fd6ff" /><circle cx="61" cy="82" r="2.6" fill="#ff5fd2" /><circle cx="69" cy="82" r="2.6" fill="#7ef0b4" />
            <circle cx="60" cy="40" r="30" fill="url(#as-suit)" />
            <ellipse cx="60" cy="42" rx="22" ry="18" fill="url(#as-visor)" />
            <ellipse cx="51" cy="35" rx="8" ry="4.5" fill="#ffffff" opacity="0.55" transform="rotate(-24 51 35)" />
            <circle cx="70" cy="49" r="2" fill="#ffffff" opacity="0.4" />
          </svg>
        </div></div></div></div>
        <div className="sky-scene"><div className="sky-rise">
          <div className="nb-halo" />
          <div className="nb-sys">
            <div className="nb-planet" />
            <div className="nb-orbit">
              <div className="nb-ring" />
              <div className="nb-spin o1"><b className="nb-moon o1" /></div>
              <div className="nb-spin o2"><b className="nb-moon o2" /></div>
              <div className="nb-spin o3"><b className="nb-moon o3" /></div>
            </div>
          </div>
          <div className="lu-halo" />
          <div className="lu-moon"><i className="lu-craters" /></div>
        </div></div>
        <div className="gx-scene"><div className="gx-rise">
          <div className="gx-tilt">
            <div className="gx-glow" />
            <div className="gx-disc">
              <i className="gx-arm a1" /><i className="gx-arm a2" /><i className="gx-arm a3" /><i className="gx-arm a4" /><i className="gx-arm a5" /><i className="gx-arm a6" />
              <i className="gx-dust d1" /><i className="gx-dust d2" /><i className="gx-dust d3" /><i className="gx-speck" />
            </div>
          </div>
          <div className="gx-bulge" />
          <i className="gx-sat s1" /><i className="gx-sat s2" />
        </div></div>
      </div>
      {/* the professional looks' backgrounds (pro.css): a chip's circuit
          traces with signals running (Graphite), a network map with packets
          moving between servers (Ops) */}
      <div className="pro-bg" aria-hidden>
        {['tr', 'br'].map((c) => (
          <div key={c} className={`circ ${c}`}>
            <i className="circ-pk c1" /><i className="circ-pk c2 v" /><i className="circ-pk c3" />
          </div>
        ))}
        <div className="net-map">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => <i key={n} className={`net-pk p${n}`} />)}
          {[1, 2, 3, 4].map((n) => <i key={`g${n}`} className={`net-ping g${n}`} />)}
        </div>
      </div>
      <nav className="nav-rail" aria-label="Main">
        <div className="nav-rail-top">
          <div className="brand grad-text">{t('brand')}</div>
          <button className="nav-search-btn" onClick={() => setSearching(true)} aria-label={t('search.trigger')} title={t('search.trigger')}><Icon name="search" size={16} /></button>
        </div>
        {nav('')}
        <div style={{ flex: 1 }} />
        <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <span className="ico" aria-hidden><Icon name="settings" /></span>
          <span>{t('nav.settings')}</span>
        </NavLink>
        <NavLink to="/settings" className="sync-link" title="Sync status — open settings">
          <span className={`sync-dot ${sync}`}><i />{t(syncKey[sync])}</span>
        </NavLink>
      </nav>
      <main className="shell-main">
        {(sync === 'signed-out' || sync === 'local-only' || sync === 'other-account') && (
          <div className={`update-bar ${sync !== 'local-only' ? 'warn-bar' : ''}`} role="status">
            <span>{t(sync === 'signed-out' ? 'app.signedOut' : sync === 'other-account' ? 'app.otherAccount' : 'app.demoBar')}</span>
            <NavLink className="btn btn-primary" to={sync === 'signed-out' ? '/login?signedout=1' : sync === 'other-account' ? '/login?other=1' : '/login'}>{t('app.signIn')}</NavLink>
          </div>
        )}
        <ReminderBanners />
        {(timer || focus) && <TimerBar timer={timer} focus={focus} />}
        {hasUpdate && (
          <div className="update-bar" role="status">
            <span>{t('app.updateReady')}</span>
            <button type="button" className="btn btn-primary" onClick={applyUpdate}>{t('app.refresh')}</button>
          </div>
        )}
        <PageGuard page={pathname}><Outlet /></PageGuard>
      </main>
      <nav
        className={`nav-bottom ${compact ? 'compact' : ''}`}
        aria-label="Main"
        onClickCapture={(e) => { if (compact) { e.preventDefault(); e.stopPropagation(); setCompact(false) } }}
      >
        {nav('')}
      </nav>
      <button className="fab fab-desktop" aria-label="Add task" onClick={() => setAdding(true)}><Icon name="plus" size={24} strokeWidth={2.2} /></button>
      <button className="fab fab-float" aria-label="Add task" onClick={() => setAdding(true)}><Icon name="plus" size={24} strokeWidth={2.2} /></button>
      <NavLink to="/settings" className="gear-mobile" aria-label="Settings"><Icon name="settings" /></NavLink>
      <button className="search-mobile" onClick={() => setSearching(true)} aria-label={t('search.trigger')}><Icon name="search" /></button>
      {adding && <TaskForm task={null} onClose={() => setAdding(false)} />}
      {searching && (
        <SearchModal
          onClose={() => setSearching(false)}
          onOpenTask={(task) => setSearchTask(task)}
        />
      )}
      {searchTask && <TaskForm task={searchTask} onClose={() => setSearchTask(null)} />}
      <AppWindow />
      <FocusMode />
      <Toaster />
    </div>
    </VideoProvider>
  )
}
