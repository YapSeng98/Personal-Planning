// Liquid Glass: with a mouse, light gathers on the panel under the pointer
// (glass.css .g-lit). One panel at a time, desktop pointers only.

const PANELS = '.card, .tcard, .m-card, .board-card, .stat-tile, .hero-card, .hx-row'

export function startGlassLight(): void {
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
  let lit: HTMLElement | null = null
  let frame = 0
  let last: PointerEvent | null = null
  const paint = () => {
    frame = 0
    const e = last
    if (!e) return
    const el = (e.target as Element | null)?.closest?.(PANELS) as HTMLElement | null
    if (el !== lit) {
      lit?.classList.remove('g-lit')
      lit = el
      lit?.classList.add('g-lit')
    }
    if (lit) {
      const r = lit.getBoundingClientRect()
      lit.style.setProperty('--gx', `${e.clientX - r.left}px`)
      lit.style.setProperty('--gy', `${e.clientY - r.top}px`)
    }
  }
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return
    last = e
    if (!frame) frame = requestAnimationFrame(paint)
  }, { passive: true })
  document.addEventListener('pointerleave', () => { lit?.classList.remove('g-lit'); lit = null })
}
