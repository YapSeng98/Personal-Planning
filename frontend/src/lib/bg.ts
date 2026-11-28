// Curated app backgrounds (the wallpaper behind the glass). Each is a set of
// soft colour glows over the theme surface (tokens.css / glass.css --app-bg).
// 'nebula' (the default) is Cosmic made cinematic — a planet with a ring,
// nebula clouds, a chrome clock (nebula.css): everything Cosmic has, so it
// runs as data-bg='cosmic' plus data-nebula; 'galaxy' — a spiral galaxy like
// Andromeda (galaxy.css) — and 'lunar' (Moon) — black, a white moon
// (lunar.css) — the same way. All three have the moving sky (sky.css,
// data-sky). 'cosmic' is the deep-space look (cosmic.css — always dark);
// 'liquid' the Liquid Glass wallpaper (glass.css). 'graphite' (Linear-style)
// and 'ops' (a NOC screen) are the flat professional looks (pro.css): no
// glass, no sky.
import { applyTheme } from './theme'

export type Bg = 'nebula' | 'galaxy' | 'lunar' | 'graphite' | 'ops' | 'cosmic' | 'liquid' | 'none' | 'sunrise' | 'aurora' | 'dusk' | 'ember' | 'bloom'
export const BGS: Bg[] = ['nebula', 'galaxy', 'lunar', 'graphite', 'ops', 'cosmic', 'liquid', 'none', 'sunrise', 'aurora', 'dusk', 'ember', 'bloom']

const KEY = 'planner_bg'
// Each new look the owner picked starts every device on it once, whatever it
// had before; a choice made after that sticks. Cosmic 2026-10-30, Nebula
// 2026-11-17 (picked from the 3D previews).
const V3 = 'planner_bg_v3'
const V4 = 'planner_bg_v4'

export function getBg(): Bg {
  try {
    if (!localStorage.getItem(V3)) {
      localStorage.setItem(V3, '1')
      localStorage.setItem(KEY, 'cosmic')
    }
    if (!localStorage.getItem(V4)) {
      localStorage.setItem(V4, '1')
      localStorage.setItem(KEY, 'nebula')
    }
    const v = localStorage.getItem(KEY)
    return (BGS as string[]).includes(v ?? '') ? (v as Bg) : 'nebula'
  } catch {
    return 'nebula'
  }
}

export function applyBg(b: Bg = getBg()) {
  const root = document.documentElement
  // Nebula, Galaxy and Moon are Cosmic underneath (its shapes and type) with
  // their own moving sky and colours
  const sky = b === 'nebula' || b === 'galaxy' || b === 'lunar'
  root.setAttribute('data-bg', sky ? 'cosmic' : b)
  root.toggleAttribute('data-sky', sky)
  root.toggleAttribute('data-nebula', b === 'nebula')
  root.toggleAttribute('data-galaxy', b === 'galaxy')
  root.toggleAttribute('data-lunar', b === 'lunar')
  applyTheme() // the window bar follows (Cosmic is always dark)
}

// The 3D objects option (2026-11-28) was removed the same day at the
// owner's word ("not what I want"); forget the choice on devices that made it.
try { localStorage.removeItem('planner_objects') } catch { /* nothing kept */ }

export function setBg(b: Bg) {
  try {
    localStorage.setItem(KEY, b)
  } catch {
    /* storage blocked: applies for this visit */
  }
  applyBg(b)
}
