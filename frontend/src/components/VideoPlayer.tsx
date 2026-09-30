import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
  type ReactNode,
} from 'react'
import { getYoutubeUrl, extractYoutubeId, postYoutubeCommand, YOUTUBE_CHANGED } from '../lib/youtube'
import { useLang } from '../lib/i18n'
import { useNowPlaying, livePosition, type NowPlaying } from '../lib/nowPlaying'

/* The player lives in the Shell (outside <Outlet/>) so navigating between
   pages never unmounts it — reparenting an <iframe> reloads it, which would
   restart the video, so the element stays put and only its CSS box moves:
   over the Today hero's slot while that page is open, docked to a corner
   mini-player everywhere else. */

interface VideoCtx {
  videoId: string | null
  playing: boolean
  play: () => void
  stop: () => void
  setSlot: (el: HTMLElement | null) => void
  /** A YouTube / YouTube Music tab reported by the browser extension. */
  nowPlaying: NowPlaying | null
  focusTab: () => void
}

const Ctx = createContext<VideoCtx>({
  videoId: null, playing: false, play: () => {}, stop: () => {}, setSlot: () => {},
  nowPlaying: null, focusTab: () => {},
})

export const useVideo = () => useContext(Ctx)

interface Box { top: number; left: number; width: number; height: number }

export function VideoProvider({ children }: { children: ReactNode }) {
  const [videoId, setVideoId] = useState<string | null>(() => extractYoutubeId(getYoutubeUrl()))
  const [playing, setPlaying] = useState(false)
  const [slot, setSlotState] = useState<HTMLElement | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const [volume, setVolume] = useState(100)
  const [muted, setMuted] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const playStartRef = useRef<number | null>(null)
  const { t } = useLang()
  const { nowPlaying, focusTab } = useNowPlaying()

  const play = useCallback(() => {
    playStartRef.current = Date.now()
    setPlaying(true)
  }, [])
  const stop = useCallback(() => {
    playStartRef.current = null
    setPlaying(false)
  }, [])

  // A real background switch (leaving the app/browser entirely) can't be
  // kept playing from here — that's the OS/browser's call, not ours, for a
  // cross-origin embed. What we CAN do: a deliberate one-tap handoff to the
  // real YouTube app/site, resuming at roughly the same spot, so leaving on
  // purpose doesn't mean starting over. Wall-clock-since-play is an
  // approximation (doesn't see the user scrubbing the embed's own seek bar),
  // but for the passive background-video use case this player is for, that's
  // close enough without wiring up the IFrame API's message-listening side.
  const openInYoutube = useCallback(() => {
    if (!videoId) return
    const elapsed = playStartRef.current ? Math.round((Date.now() - playStartRef.current) / 1000) : 0
    const ts = elapsed >= 3 ? `&t=${elapsed}s` : ''
    window.open(`https://www.youtube.com/watch?v=${videoId}${ts}`, '_blank', 'noopener,noreferrer')
  }, [videoId])

  // Reassert volume/mute once the (freshly mounted) player has loaded — the
  // iframe remounts every time playback (re)starts, which resets its state.
  const onIframeLoad = useCallback(() => {
    postYoutubeCommand(iframeRef.current, 'setVolume', [volume])
    postYoutubeCommand(iframeRef.current, muted ? 'mute' : 'unMute')
  }, [volume, muted])

  const changeVolume = useCallback((v: number) => {
    setVolume(v)
    setMuted(false)
    postYoutubeCommand(iframeRef.current, 'unMute')
    postYoutubeCommand(iframeRef.current, 'setVolume', [v])
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      postYoutubeCommand(iframeRef.current, m ? 'unMute' : 'mute')
      return !m
    })
  }, [])

  // Settings can change the URL while the app is open.
  useEffect(() => {
    const sync = () => setVideoId(extractYoutubeId(getYoutubeUrl()))
    window.addEventListener(YOUTUBE_CHANGED, sync)
    return () => window.removeEventListener(YOUTUBE_CHANGED, sync)
  }, [])

  // A cleared/changed video must not leave an orphaned player running.
  useEffect(() => { if (!videoId) setPlaying(false) }, [videoId])

  const setSlot = useCallback((el: HTMLElement | null) => setSlotState(el), [])

  // Track the hero slot's on-screen box. Scroll uses capture so inner scroll
  // containers count too, not just the window.
  useLayoutEffect(() => {
    if (!slot || !playing) { setBox(null); return }
    let frame = 0
    const measure = () => {
      const r = slot.getBoundingClientRect()
      setBox((prev) =>
        prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height })
    }
    const onMove = () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; measure() })
    }
    measure()
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    const ro = new ResizeObserver(onMove)
    ro.observe(slot)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
      ro.disconnect()
    }
  }, [slot, playing])

  const docked = box !== null
  const style = docked
    ? { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` }
    : undefined

  return (
    <Ctx.Provider value={{ videoId, playing, play, stop, setSlot, nowPlaying, focusTab }}>
      {children}
      {videoId && playing && (
        <div className={`hv-float ${docked ? 'docked' : 'mini'}`} style={style}>
          <iframe
            ref={iframeRef}
            onLoad={onIframeLoad}
            src={`https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1&origin=${encodeURIComponent(window.location.origin)}`}
            title="YouTube"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
          <button className="hv-btn stop" onClick={stop} aria-label={t('today.videoStop')} title={t('today.videoStop')}>
            ⏹
          </button>
          <a
            className="hv-btn open"
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => { e.preventDefault(); openInYoutube() }}
            aria-label={t('today.videoOpen')}
            title={t('today.videoOpen')}
          >
            ↗
          </a>
          {/* The embed's own control bar only has a mute toggle, no
              draggable slider — this drives real volume via postMessage. */}
          <div className="hv-vol">
            <button
              className="hv-vol-mute"
              onClick={toggleMute}
              aria-label={t(muted ? 'today.videoUnmute' : 'today.videoMute')}
              title={t(muted ? 'today.videoUnmute' : 'today.videoMute')}
            >
              {muted || volume === 0 ? '🔇' : '🔉'}
            </button>
            <input
              type="range"
              className="hv-vol-slider"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              onChange={(e) => changeVolume(Number(e.target.value))}
              aria-label={t('today.videoVolume')}
              title={t('today.videoVolume')}
            />
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}

/** The in-hero placeholder on Today: reserves the space and shows the poster
    until playback starts, after which the floating player covers it. */
export function HeroVideoSlot() {
  const { videoId, playing, play, setSlot, nowPlaying, focusTab } = useVideo()
  const ref = useRef<HTMLDivElement | null>(null)
  const { t } = useLang()

  useEffect(() => {
    setSlot(ref.current)
    return () => setSlot(null)
  }, [setSlot, videoId])

  // An open YouTube tab wins over the Settings link — unless the embed is
  // already playing, which must not be yanked away mid-video.
  if (nowPlaying && !playing) {
    return (
      <div className="hero-video" ref={ref}>
        <TabNowPlaying np={nowPlaying} onFocus={focusTab} />
      </div>
    )
  }

  if (!videoId) return null

  return (
    <div className="hero-video" ref={ref}>
      {!playing && (
        <>
          <button className="hv-poster" onClick={play} aria-label={t('today.videoPlay')}>
            <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" />
            <span className="hv-play" aria-hidden>▶</span>
          </button>
          <a
            className="hv-btn open"
            href={`https://www.youtube.com/watch?v=${videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t('today.videoOpen')}
            title={t('today.videoOpen')}
          >
            ↗
          </a>
        </>
      )}
    </div>
  )
}

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`
}

/** Mirror of what's playing in another tab. Tapping switches to that tab —
    playing it here too would double the audio. */
function TabNowPlaying({ np, onFocus }: { np: NowPlaying; onFocus: () => void }) {
  const { t } = useLang()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!np.playing) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [np.playing])

  const pos = livePosition(np, np.playing ? now : np.at)
  const pct = np.duration ? (pos / np.duration) * 100 : 0
  const label = np.source === 'music' ? 'YouTube Music' : 'YouTube'

  return (
    <button
      className={`hv-poster hv-tab ${np.playing ? 'is-playing' : 'is-paused'}`}
      onClick={onFocus}
      aria-label={t('today.tabGoTo', { src: label })}
      title={t('today.tabGoTo', { src: label })}
    >
      <img src={np.artwork} alt="" />
      <span className="hv-tab-badge">
        {np.playing ? <span className="hv-eq" aria-hidden><i /><i /><i /></span> : <span aria-hidden>❚❚</span>}
        <span>{np.playing ? t('today.tabPlaying') : t('today.tabPaused')} · {label}</span>
      </span>
      <span className="hv-tab-meta">
        <span className="hv-tab-title">{np.title}</span>
        {np.artist && <span className="hv-tab-artist">{np.artist}</span>}
        {np.duration > 0 && (
          <span className="hv-tab-prog">
            <span className="hv-tab-bar"><span style={{ width: `${pct}%` }} /></span>
            <span className="hv-tab-time">{fmt(pos)} / {fmt(np.duration)}</span>
          </span>
        )}
      </span>
    </button>
  )
}
