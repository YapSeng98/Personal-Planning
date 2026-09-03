// The hero-panel video is a personal, local-only preference (which video to
// show), stored in localStorage — like the AI proxy URL in lib/ai.ts — not
// synced through ServiceNow, so it can differ per device.

const KEY = 'planner_youtube_url'

/** Fired when the URL changes so the player (mounted in the Shell, not on the
    Settings page) can pick it up without a reload. */
export const YOUTUBE_CHANGED = 'planner:youtube'

export function getYoutubeUrl(): string {
  return localStorage.getItem(KEY) ?? ''
}
export function setYoutubeUrl(url: string) {
  const u = url.trim()
  if (u) localStorage.setItem(KEY, u)
  else localStorage.removeItem(KEY)
  window.dispatchEvent(new CustomEvent(YOUTUBE_CHANGED))
}

/** Extract the 11-char video id from any common YouTube URL shape (watch,
    youtu.be, live, embed). Returns null if the URL doesn't match. */
export function extractYoutubeId(url: string): string | null {
  const u = url.trim()
  if (!u) return null
  const m = u.match(/(?:youtube\.com\/(?:watch\?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
  return m ? m[1] : null
}
