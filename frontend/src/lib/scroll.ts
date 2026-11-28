// Which element scrolls the page. On computers the app sits in a window
// (styles/vision.css) and `.shell-main` scrolls by itself; on phones the
// page scrolls as usual. Use these instead of window.scrollY / scrollTo.

export function pageScroller(): HTMLElement | null {
  const m = document.querySelector<HTMLElement>('.shell-main')
  return m && getComputedStyle(m).overflowY === 'auto' ? m : null
}

export function pageScrollY(): number {
  const s = pageScroller()
  return s ? s.scrollTop : window.scrollY
}

export function pageScrollTo(top: number, behavior: ScrollBehavior = 'auto') {
  const s = pageScroller()
  if (s) s.scrollTo({ top, behavior })
  else window.scrollTo({ top, behavior })
}

/** Scrolling of the page (not of a list or box inside it), whichever element scrolls it. */
export function onPageScroll(fn: () => void): () => void {
  const h = (e: Event) => {
    const t = e.target
    if (t === document || t === window || (t instanceof HTMLElement && t.classList.contains('shell-main'))) fn()
  }
  window.addEventListener('scroll', h, { capture: true, passive: true })
  return () => window.removeEventListener('scroll', h, { capture: true })
}
