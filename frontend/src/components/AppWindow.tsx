import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type CSSProperties } from 'react'
import Icon from './Icon'
import { useLang } from '../lib/i18n'
import { OPEN_APP, QUICK_APPS, openApp, type WebApp } from '../lib/appWindow'

/* The owner's other apps (quick apps, Daily Brief), open over the Planner
   instead of in another tab. Lives in the Shell, so it stays open — and
   each app keeps its place — while you move between pages. Several apps
   open as tabs; each keeps its own frame, so switching doesn't reload.

   Desktop: a small window you drag by its title bar and resize from the
   corner (both remembered), or full screen. Phones: a sheet from the
   bottom, or full screen. Minimised, it's a pill at the bottom. */

type Size = 'small' | 'full'
interface Box { x: number; y: number; w: number; h: number }

const BOX_KEY = 'planner_appwin_box'
const SIZE_KEY = 'planner_appwin_size'
const MIN_W = 320
const MIN_H = 360
const PHONE = '(max-width: 639px)'

function load(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* private mode: just not remembered */
  }
}

/** On screen in full, and no bigger than it. */
function fit(b: Box): Box {
  const vw = window.innerWidth, vh = window.innerHeight
  const w = Math.max(Math.min(b.w, vw - 16), Math.min(MIN_W, vw - 16))
  const h = Math.max(Math.min(b.h, vh - 16), Math.min(MIN_H, vh - 16))
  return { w, h, x: Math.min(Math.max(b.x, 8), vw - w - 8), y: Math.min(Math.max(b.y, 8), vh - h - 8) }
}

/** Bottom right, beside the add / quick-apps buttons rather than over them. */
function defaultBox(): Box {
  const vw = window.innerWidth, vh = window.innerHeight
  const w = Math.min(440, vw - 140), h = Math.min(700, vh - 64)
  return fit({ w, h, x: vw - w - 112, y: vh - h - 32 })
}

function savedBox(): Box {
  const b = load(BOX_KEY) as Box | null
  return fit(b && [b.x, b.y, b.w, b.h].every(Number.isFinite) ? b : defaultBox())
}

export default function AppWindow() {
  const { t } = useLang()
  const [apps, setApps] = useState<WebApp[]>([])
  const [active, setActive] = useState('')
  const [size, setSize] = useState<Size>(() => (load(SIZE_KEY) === 'full' ? 'full' : 'small'))
  const [minimised, setMinimised] = useState(false)
  const [box, setBox] = useState<Box>(savedBox)
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches)
  const [moving, setMoving] = useState(false)
  const [loaded, setLoaded] = useState<Record<string, boolean>>({})
  const [reloads, setReloads] = useState<Record<string, number>>({})
  const [online, setOnline] = useState(navigator.onLine)
  const [menu, setMenu] = useState(false)
  const swallowClick = useRef(false)
  const tabsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onOpen = (e: Event) => {
      const app = (e as CustomEvent<WebApp>).detail
      setApps((l) => (l.some((a) => a.url === app.url) ? l : [...l, app]))
      setActive(app.url)
      setMinimised(false)
    }
    const mq = window.matchMedia(PHONE)
    const onPhone = () => setPhone(mq.matches)
    const onResize = () => setBox((b) => fit(b))
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener(OPEN_APP, onOpen)
    mq.addEventListener('change', onPhone)
    window.addEventListener('resize', onResize)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener(OPEN_APP, onOpen)
      mq.removeEventListener('change', onPhone)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // back online: load what couldn't load
  useEffect(() => {
    if (!online) return
    setReloads((r) => {
      const next = { ...r }
      for (const a of apps) if (!loaded[a.url]) next[a.url] = (next[a.url] ?? 0) + 1
      return next
    })
    // only when the connection comes back
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online])

  // the app being shown keeps its tab in view when there are more than fit
  useEffect(() => {
    tabsRef.current?.querySelector('.appwin-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, apps.length])

  if (!apps.length) return null
  const current = apps.find((a) => a.url === active) ?? apps[0]
  const floating = !phone && size === 'small'

  const pickSize = (s: Size) => {
    setSize(s)
    save(SIZE_KEY, s)
  }
  const close = (url: string) => {
    const i = apps.findIndex((a) => a.url === url)
    const rest = apps.filter((a) => a.url !== url)
    setApps(rest)
    if (url === current.url && rest.length) setActive(rest[Math.min(i, rest.length - 1)].url)
    setLoaded(({ [url]: _gone, ...l }) => l)
  }
  const closeAll = () => {
    setMenu(false)
    setApps([])
    setLoaded({})
    setMinimised(false)
  }
  const reload = () => {
    setLoaded(({ [current.url]: _was, ...l }) => l)
    setReloads((r) => ({ ...r, [current.url]: (r[current.url] ?? 0) + 1 }))
  }

  // Moving / resizing: a few pixels before it counts, so tapping a tab is
  // still a tap. Followed on the whole page (a quick first move can leave
  // the bar before it sees one), and the frames stop taking the pointer
  // meanwhile — a drag over one would otherwise be lost to the app inside.
  const begin = (kind: 'move' | 'resize') => (e: ReactPointerEvent<HTMLElement>) => {
    if (!floating || e.button !== 0) return
    if (kind === 'move' && (e.target as HTMLElement).closest('.appwin-btns, .appwin-tab-x, .appwin-add')) return
    const d = { kind, sx: e.clientX, sy: e.clientY, b: box, moved: false }
    setMoving(true)
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy
      if (!d.moved && Math.abs(dx) + Math.abs(dy) < 5) return
      d.moved = true
      if (kind === 'move') setBox(fit({ ...d.b, x: d.b.x + dx, y: d.b.y + dy }))
      else {
        const vw = window.innerWidth, vh = window.innerHeight
        setBox(fit({ ...d.b, w: Math.min(Math.max(d.b.w + dx, MIN_W), vw - d.b.x - 8), h: Math.min(Math.max(d.b.h + dy, MIN_H), vh - d.b.y - 8) }))
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setMoving(false)
      if (!d.moved) return
      // the click a moved title bar fires right after letting go (a tab under
      // the pointer would take it); none comes if it ended off the window
      if (kind === 'move') {
        swallowClick.current = true
        window.setTimeout(() => { swallowClick.current = false }, 0)
      }
      setBox((b) => {
        save(BOX_KEY, b)
        return b
      })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const style: CSSProperties | undefined = floating ? { left: box.x, top: box.y, width: box.w, height: box.h } : undefined

  return (
    <>
      <div
        className={`appwin ${phone ? 'phone' : ''} ${size === 'full' ? 'full' : ''} ${minimised ? 'min' : ''} ${moving ? 'moving' : ''}`}
        style={{ ...style, ['--app-accent' as string]: current.color }}
        role="dialog"
        aria-modal="false"
        aria-label={current.title}
      >
        <div
          className="appwin-bar"
          onPointerDown={begin('move')}
          onClickCapture={(e) => {
            if (!swallowClick.current) return
            swallowClick.current = false
            e.stopPropagation()
            e.preventDefault()
          }}
          onDoubleClick={(e) => { if (!phone && !(e.target as HTMLElement).closest('.appwin-btns')) pickSize(size === 'full' ? 'small' : 'full') }}
        >
          <div className="appwin-tabs" role="tablist" ref={tabsRef}>
            {apps.map((a) => (
              <div
                key={a.url}
                role="tab"
                tabIndex={0}
                aria-selected={a.url === current.url}
                className={`appwin-tab ${a.url === current.url ? 'on' : ''}`}
                style={{ ['--app-accent' as string]: a.color }}
                title={a.title}
                onClick={() => setActive(a.url)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActive(a.url) } }}
              >
                <span className="ico" aria-hidden>{a.icon}</span>
                <span className="nm">{a.title}</span>
                {apps.length > 1 && (
                  <button type="button" className="appwin-tab-x" aria-label={t('appwin.closeApp', { app: a.title })} onClick={(e) => { e.stopPropagation(); close(a.url) }}>
                    <Icon name="close" size={12} strokeWidth={2.2} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button type="button" className={`appwin-btn appwin-add ${menu ? 'on' : ''}`} onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-label={t('appwin.add')} title={t('appwin.add')}>
            <Icon name="plus" size={17} />
          </button>
          <div className="appwin-btns">
            {/* phones: in the + menu, so the app's name has room */}
            {!phone && (
              <>
                <button type="button" className="appwin-btn" onClick={reload} aria-label={t('appwin.reload')} title={t('appwin.reload')}><Icon name="reload" size={17} /></button>
                <a className="appwin-btn" href={current.url} target="_blank" rel="noopener noreferrer" aria-label={t('appwin.newTab')} title={t('appwin.newTab')}><Icon name="external" size={17} /></a>
              </>
            )}
            <button type="button" className="appwin-btn" onClick={() => setMinimised(true)} aria-label={t('appwin.minimise')} title={t('appwin.minimise')}><Icon name="minimise" size={17} /></button>
            <button type="button" className="appwin-btn" onClick={() => pickSize(size === 'full' ? 'small' : 'full')} aria-label={t(size === 'full' ? 'appwin.small' : 'appwin.full')} title={t(size === 'full' ? 'appwin.small' : 'appwin.full')}>
              <Icon name={size === 'full' ? 'shrink' : 'expand'} size={17} />
            </button>
            <button type="button" className="appwin-btn" onClick={closeAll} aria-label={t('common.close')} title={t('common.close')}><Icon name="close" size={17} /></button>
          </div>
        </div>
        {menu && (
          <div className="appwin-menu" role="menu">
            {QUICK_APPS.map((a) => (
              <button
                key={a.url}
                type="button"
                role="menuitem"
                className={apps.some((x) => x.url === a.url) ? 'open' : ''}
                onClick={() => { setMenu(false); openApp({ url: a.url, title: t(a.labelKey), icon: a.icon, color: a.color }) }}
              >
                <span className="ico" aria-hidden>{a.icon}</span>
                <span>{t(a.labelKey)}</span>
              </button>
            ))}
            {phone && (
              <>
                <hr />
                <button type="button" role="menuitem" onClick={() => { setMenu(false); reload() }}>
                  <span className="ico" aria-hidden><Icon name="reload" size={17} /></span>
                  <span>{t('appwin.reload')}</span>
                </button>
                <a role="menuitem" href={current.url} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(false)}>
                  <span className="ico" aria-hidden><Icon name="external" size={17} /></span>
                  <span>{t('appwin.newTab')}</span>
                </a>
              </>
            )}
          </div>
        )}
        <div className="appwin-body" onPointerDown={() => setMenu(false)}>
          {apps.map((a) => (
            <iframe
              key={`${a.url}#${reloads[a.url] ?? 0}`}
              src={a.url}
              title={a.title}
              className={a.url === current.url ? 'on' : ''}
              allow="clipboard-read; clipboard-write; fullscreen; autoplay; web-share"
              onLoad={() => { if (navigator.onLine) setLoaded((l) => ({ ...l, [a.url]: true })) }}
            />
          ))}
          {!online && !loaded[current.url] ? (
            <div className="appwin-note offline">
              <b>{t('appwin.offline', { app: current.title })}</b>
            </div>
          ) : !loaded[current.url] && (
            <div className="appwin-note" aria-live="polite">
              <span className="appwin-spin" aria-hidden />
              <span>{t('appwin.opening', { app: current.title })}</span>
            </div>
          )}
        </div>
        {floating && (
          <div className="appwin-resize" onPointerDown={begin('resize')} aria-hidden />
        )}
      </div>
      {minimised && (
        <div className="appwin-pill">
          <button type="button" className="appwin-pill-main" onClick={() => setMinimised(false)} aria-label={t('appwin.show', { app: current.title })}>
            <span className="ico" aria-hidden>{current.icon}</span>
            <span className="nm">{current.title}</span>
            {apps.length > 1 && <span className="more num">+{apps.length - 1}</span>}
          </button>
          <button type="button" className="appwin-pill-x" onClick={closeAll} aria-label={t('common.close')}><Icon name="close" size={14} strokeWidth={2.2} /></button>
        </div>
      )}
    </>
  )
}
