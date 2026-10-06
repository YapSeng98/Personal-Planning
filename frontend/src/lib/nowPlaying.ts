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
  /** When the tab last started playing / you last switched to it (ms) —
      extension 1.1+. */
  startedAt?: number
  focusedAt?: number
}

/** The version in extension/manifest.json — keep the two in step. The zip
    of the folder is published with the app (vite.config.ts). */
export const EXTENSION_VERSION = '1.2.0'
export const EXTENSION_ZIP = `${import.meta.env.BASE_URL}planner-now-playing.zip`

/** Browser extensions of this kind run in desktop Chrome / Edge / Brave. */
export function canUseExtension(): boolean {
  const ua = navigator.userAgent
  const touchMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1 // an iPad asking for the desktop site
  return /Chrome\//.test(ua) && !/Android|iPhone|iPad|iPod|Mobile/i.test(ua) && !touchMac
}

/** Is `a` an older version than `b` ("1.0.0" < "1.1.0")? */
export function olderVersion(a: string, b: string): boolean {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0)
  }
  return false
}

function isNowPlaying(x: unknown): x is NowPlaying {
  const n = x as NowPlaying
  return !!n && typeof n.videoId === 'string' && typeof n.title === 'string' && typeof n.tabId === 'number'
}

export function useNowPlaying() {
  const [np, setNp] = useState<NowPlaying | null>(null)
  // Any message from the extension means it's installed; 1.0 sent no version.
  const [extension, setExtension] = useState<{ installed: boolean; version: string | null }>({ installed: false, version: null })

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return
      if (e.data?.type !== 'planner-np') return
      setNp(isNowPlaying(e.data.nowPlaying) ? e.data.nowPlaying : null)
      const version = typeof e.data.version === 'string' ? e.data.version : '1.0.0'
      setExtension((x) => (x.installed && x.version === version ? x : { installed: true, version }))
    }
    window.addEventListener('message', onMsg)
    // Ask for the current state in case the extension posted before we mounted.
    window.postMessage({ type: 'planner-np-request' }, window.location.origin)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const focus = useCallback(() => {
    if (np) window.postMessage({ type: 'planner-np-focus', tabId: np.tabId, windowId: np.windowId }, window.location.origin)
  }, [np])

  return { nowPlaying: np, focusTab: focus, extension }
}

/** Live position: the report's position plus time elapsed since, while playing. */
export function livePosition(np: NowPlaying, now: number): number {
  const p = np.playing ? np.position + (now - np.at) / 1000 : np.position
  return np.duration ? Math.min(p, np.duration) : p
}
