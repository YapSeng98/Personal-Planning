import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState,
  type ReactNode,
} from 'react'
import { getYoutubeUrl, extractYoutubeId, postYoutubeCommand, YOUTUBE_CHANGED } from '../lib/youtube'
import { useLang } from '../lib/i18n'

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
}

const Ctx = createContext<VideoCtx>({
  videoId: null, playing: false, play: () => {}, stop: () => {}, setSlot: () => {},
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
  const { t } = useLang()

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
    <Ctx.Provider value={{ videoId, playing, play: () => setPlaying(true), stop: () => setPlaying(false), setSlot }}>
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
          <button className="hv-btn stop" onClick={() => setPlaying(false)} aria-label={t('today.videoStop')} title={t('today.videoStop')}>
            ⏹
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
  const { videoId, playing, play, setSlot } = useVideo()
  const ref = useRef<HTMLDivElement | null>(null)
  const { t } = useLang()

  useEffect(() => {
    setSlot(ref.current)
    return () => setSlot(null)
  }, [setSlot, videoId])

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
