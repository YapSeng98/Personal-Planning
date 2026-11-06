// At rest — nothing touched for a while, or the window in the background — the
// decorative endless animations (the turning colour edges, pulsing dots, the
// chart's ping, a nudging button) pause where they are; any pointer move, tap,
// key, wheel or scroll brings them back at once (glass.css, :root[data-rest]).
//
// Why: while any of them runs, the browser redraws the whole screen 60 times a
// second — and re-blurs every glass panel — so the app just sitting open kept
// about a fifth of the graphics chip busy (measured on Today: 241 frames per
// 4 s; at rest: 4, the clock's seconds). Loading indicators, the video's and
// music's bars and focus mode keep moving.
const IDLE_MS = 20_000
const AWAY_MS = 3_000

let started = false
export function startRestMode(): void {
  if (started) return
  started = true
  const root = document.documentElement
  let timer = 0
  let last = 0
  const rest = () => root.setAttribute('data-rest', '')
  const restIn = (ms: number) => { window.clearTimeout(timer); timer = window.setTimeout(rest, ms) }
  const wake = () => {
    const now = Date.now()
    if (root.hasAttribute('data-rest')) root.removeAttribute('data-rest')
    else if (now - last < 1000) return // a stream of pointer moves resets the clock once a second
    last = now
    restIn(document.hasFocus() ? IDLE_MS : AWAY_MS)
  }
  for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
    window.addEventListener(ev, wake, { passive: true, capture: true })
  }
  window.addEventListener('focus', wake)
  window.addEventListener('blur', () => restIn(AWAY_MS))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) wake() })
  wake()
}
