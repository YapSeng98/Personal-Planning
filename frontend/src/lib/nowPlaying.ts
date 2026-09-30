import { useCallback, useEffect, useState } from 'react'

// What's playing in a YouTube / YouTube Music tab, reported by the optional
// "Planner Now Playing" browser extension (repo `extension/`). A page can't
// see other tabs on its own; the extension's content script bridges it in
// via window.postMessage. Without the extension (phones, other browsers)
// nothing ever arrives and callers fall back to the Settings video link.

export interface NowPlaying {
  videoId: string
  title: string
  artist: string
  artwork: string
  source: 'music' | 'youtube'
  playing: boolean
  position: number // seconds, as of `at`
  duration: number
  at: number // ms timestamp of the report
  tabId: number
  windowId: number
}

function isNowPlaying(x: unknown): x is NowPlaying {
  const n = x as NowPlaying
  return !!n && typeof n.videoId === 'string' && typeof n.title === 'string' && typeof n.tabId === 'number'
}

export function useNowPlaying() {
  const [np, setNp] = useState<NowPlaying | null>(null)

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return
      if (e.data?.type !== 'planner-np') return
      setNp(isNowPlaying(e.data.nowPlaying) ? e.data.nowPlaying : null)
    }
    window.addEventListener('message', onMsg)
    // Ask for the current state in case the extension posted before we mounted.
    window.postMessage({ type: 'planner-np-request' }, window.location.origin)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const focus = useCallback(() => {
    if (np) window.postMessage({ type: 'planner-np-focus', tabId: np.tabId, windowId: np.windowId }, window.location.origin)
  }, [np])

  return { nowPlaying: np, focusTab: focus }
}

/** Live position: the report's position plus time elapsed since, while playing. */
export function livePosition(np: NowPlaying, now: number): number {
  const p = np.playing ? np.position + (now - np.at) / 1000 : np.position
  return np.duration ? Math.min(p, np.duration) : p
}
