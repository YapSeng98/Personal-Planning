// Runs in youtube.com / music.youtube.com tabs. Reads what's playing and
// reports it to the background worker whenever it changes.
//
// Primary source is the Media Session metadata YouTube sets for the OS media
// controls (title/artist/artwork) — far more stable than scraping the DOM.
// Play state and position come from the <video> element: in the page, or in
// a pop-out (Document Picture-in-Picture) window YouTube moved it into. With
// no <video> at all, the Media Session's playback state stands in. The video
// id comes from the URL — or, on pages without ?v= (YouTube's mini player
// keeps playing while you browse), from the cover image's address.

;(() => {
  const isMusic = location.hostname === 'music.youtube.com'
  const ID = /^[A-Za-z0-9_-]{11}$/
  let last = ''

  function videoId(md) {
    const u = new URL(location.href)
    const v = u.searchParams.get('v')
    if (v && ID.test(v)) return v
    const m = u.pathname.match(/^\/(?:shorts|live)\/([A-Za-z0-9_-]{11})/)
    if (m) return m[1]
    for (const a of md?.artwork ?? []) {
      const t = String(a.src).match(/\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//)
      if (t) return t[1]
    }
    return ''
  }

  // the page's videos plus any in a pop-out window; the one playing first
  function findVideo() {
    let vids = [...document.querySelectorAll('video')]
    try {
      const pip = window.documentPictureInPicture?.window
      if (pip) vids = vids.concat([...pip.document.querySelectorAll('video')])
    } catch { /* no pop-out */ }
    return vids.find((v) => !v.paused && !v.ended) || vids.find((v) => v.readyState > 0) || null
  }

  function read() {
    const md = navigator.mediaSession?.metadata
    const video = findVideo()
    const id = videoId(md)
    const state = navigator.mediaSession?.playbackState
    // no <video> anywhere: only trust a Media Session that says what it's doing
    if (!video && !(md && (state === 'playing' || state === 'paused'))) return null
    const title = md?.title || (id ? document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*-\s*YouTube( Music)?$/, '') : '')
    if (!title) return null
    const art = md?.artwork?.length ? md.artwork[md.artwork.length - 1].src : id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : ''
    return {
      videoId: id,
      title,
      artist: md?.artist || '',
      artwork: art,
      source: isMusic ? 'music' : 'youtube',
      playing: video ? !video.paused && !video.ended : state === 'playing',
      // Rounded so progress ticks alone don't trigger a report every poll.
      position: video ? Math.floor(video.currentTime || 0) : 0,
      duration: video && Number.isFinite(video.duration) ? Math.floor(video.duration) : 0,
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

  // Media events don't bubble, but capture catches them on any <video> —
  // in the page and in a pop-out window when YouTube opens one.
  const EVENTS = ['play', 'pause', 'seeked', 'ended', 'loadedmetadata', 'emptied']
  const listen = (doc) => { for (const ev of EVENTS) doc.addEventListener(ev, () => report(true), true) }
  listen(document)
  try {
    window.documentPictureInPicture?.addEventListener('enter', (e) => {
      try { listen(e.window.document) } catch { /* closed already */ }
      report(true)
    })
  } catch { /* browser without pop-out windows */ }
  // SPA navigations (next song, clicking another video) change URL/metadata
  // without a page load — a light poll picks those up.
  const timer = setInterval(() => report(false), 2000)
  report(true)
})()
