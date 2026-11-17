// The Nebula / Moon sky follows the mouse (sky.css): the planet or moon and
// the twinkling stars sway a little against it — farther things less — and
// the card under the pointer leans toward it in 3D with a shine following
// it. Mouse only (a finger has no hover), at most once a frame, transforms
// (and the shine's position on that one card) only; nothing with reduced
// motion. Never a card that drags (task / board cards, Plan's days): their
// drag library measures them while they move.
let started = false
const TILT = '.hero-card, .hx, .stat-tile, .goal-card, .proj-card, .hx-row'

export function startSkyMotion(): void {
  if (started) return
  started = true
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const root = document.documentElement
  let frame = 0
  let x = 0, y = 0
  let hero: HTMLElement | null = null
  let tilted: HTMLElement | null = null

  const apply = () => {
    frame = 0
    const scene = document.querySelector<HTMLElement>('.sky-scene')
    if (scene) scene.style.transform = `translate3d(${(-x * 26).toFixed(1)}px, ${(-y * 18).toFixed(1)}px, 0)`
    document.querySelectorAll<HTMLElement>('.sky-stars').forEach((s, i) => {
      const k = i ? 12 : 6
      s.style.transform = `translate3d(${(-x * k).toFixed(1)}px, ${(-y * k).toFixed(1)}px, 0)`
    })
    if (tilted && tilted !== hero) { tilted.style.transform = ''; tilted.classList.remove('tilting'); tilted = null }
    if (hero) {
      const r = hero.getBoundingClientRect()
      const hx = (lastX - r.left) / r.width - 0.5, hy = (lastY - r.top) / r.height - 0.5
      // big cards lean less than small tiles
      const k = r.width > 500 ? 1 : 2.4
      hero.style.transform = `perspective(1200px) rotateX(${(-hy * 3 * k).toFixed(2)}deg) rotateY(${(hx * 4 * k).toFixed(2)}deg) translateZ(0)`
      hero.style.setProperty('--mx', `${Math.round((hx + 0.5) * 100)}%`)
      hero.style.setProperty('--my', `${Math.round((hy + 0.5) * 100)}%`)
      hero.classList.add('sky-tilt', 'tilting')
      tilted = hero
    }
  }
  let lastX = 0, lastY = 0
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || !(root.hasAttribute('data-nebula') || root.hasAttribute('data-lunar'))) return
    lastX = e.clientX; lastY = e.clientY
    x = e.clientX / window.innerWidth - 0.5
    y = e.clientY / window.innerHeight - 0.5
    hero = (e.target as Element | null)?.closest?.(TILT) as HTMLElement | null
    if (!frame) frame = requestAnimationFrame(apply)
  }, { passive: true })
  // the pointer leaving the window: the header settles back
  document.addEventListener('pointerleave', () => { hero = null; if (!frame) frame = requestAnimationFrame(apply) })
}
