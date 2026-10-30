// Curated app backgrounds (the wallpaper behind the glass). Each is a set of
// soft colour glows over the theme surface (tokens.css / glass.css --app-bg).
// 'liquid' is the Liquid Glass wallpaper (glass.css), and the default.

export type Bg = 'liquid' | 'none' | 'sunrise' | 'aurora' | 'dusk' | 'ember' | 'bloom'
export const BGS: Bg[] = ['liquid', 'none', 'sunrise', 'aurora', 'dusk', 'ember', 'bloom']

const KEY = 'planner_bg'
// Liquid Glass shipped 2026-10-30: every device starts on its wallpaper once,
// whatever it had before; a choice made after that sticks.
const V2 = 'planner_bg_v2'

export function getBg(): Bg {
  try {
    if (!localStorage.getItem(V2)) {
      localStorage.setItem(V2, '1')
      localStorage.setItem(KEY, 'liquid')
    }
    const v = localStorage.getItem(KEY)
    return (BGS as string[]).includes(v ?? '') ? (v as Bg) : 'liquid'
  } catch {
    return 'liquid'
  }
}

export function applyBg(b: Bg = getBg()) {
  document.documentElement.setAttribute('data-bg', b)
}

export function setBg(b: Bg) {
  try {
    localStorage.setItem(KEY, b)
  } catch {
    /* storage blocked: applies for this visit */
  }
  applyBg(b)
}
