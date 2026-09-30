// Runs in youtube.com / music.youtube.com tabs. Reads what's playing and
// reports it to the background worker whenever it changes.
//
// Primary source is the Media Session metadata YouTube sets for the OS media
// controls (title/artist/artwork) — far more stable than scraping the DOM.
// Fallbacks: the <video> element for play state/position, the URL for the id,
// and the tab title.

;(() => {
  const isMusic = location.hostname === 'music.youtube.com'
  let last = ''

  function videoId() {
    const u = new URL(location.href)
    const v = u.searchParams.get('v')
    if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v
    const m = u.pathname.match(/^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})/)
    return m ? m[1] : null
  }

  function read() {
    const id = videoId()
    const video = document.querySelector('video')
    if (!id || !video) return null
    const md = navigator.mediaSession?.metadata
    const title = md?.title || document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube( Music)?$/, '')
    if (!title) return null
    const art = md?.artwork?.length ? md.artwork[md.artwork.length - 1].src : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    return {
      videoId: id,
      title,
      artist: md?.artist || '',
      artwork: art,
      source: isMusic ? 'music' : 'youtube',
      playing: !video.paused && !video.ended,
      // Rounded so progress ticks alone don't trigger a report every poll.
      position: Math.floor(video.currentTime || 0),
      duration: Number.isFinite(video.duration) ? Math.floor(video.duration) : 0,
    }
  }

  // Ads play in the same <video> and take over the Media Session metadata;
  // both sites flag the player with `ad-showing` while one runs.
  const adShowing = () => !!document.querySelector('.html5-video-player.ad-showing')

  function report(force) {
    if (adShowing()) return // keep showing the song, not the ad
    let state
    try { state = read() } catch { state = null }
    // Compare without position — position only matters on play/pause/seek.
    const key = JSON.stringify(state && { ...state, position: undefined })
    if (!force && key === last) return
    last = key
    try {
      chrome.runtime.sendMessage({ type: 'np-state', state })
    } catch {
      // Extension was reloaded/removed — this orphaned script should stop.
      clearInterval(timer)
    }
  }

  // Media events don't bubble, but capture catches them on any <video>.
  for (const ev of ['play', 'pause', 'seeked', 'ended', 'loadedmetadata', 'emptied']) {
    document.addEventListener(ev, () => report(true), true)
  }
  // SPA navigations (next song, clicking another video) change URL/metadata
  // without a page load — a light poll picks those up.
  const timer = setInterval(() => report(false), 2000)
  report(true)
})()
