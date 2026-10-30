// Curated app backgrounds (the wallpaper behind the glass). Each is a set of
// soft colour glows over the theme surface (tokens.css / glass.css --app-bg).
// 'cosmic' is the futuristic deep-space look (cosmic.css — always dark), the
// default; 'liquid' the Liquid Glass wallpaper (glass.css).
import { applyTheme } from './theme'

export type Bg = 'cosmic' | 'liquid' | 'none' | 'sunrise' | 'aurora' | 'dusk' | 'ember' | 'bloom'
export const BGS: Bg[] = ['cosmic', 'liquid', 'none', 'sunrise', 'aurora', 'dusk', 'ember', 'bloom']

const KEY = 'planner_bg'
// Cosmic shipped 2026-10-30 (after Liquid Glass the same day): every device
// starts on it once, whatever it had before; a choice made after that sticks.
const V3 = 'planner_bg_v3'

export function getBg(): Bg {
  try {
    if (!localStorage.getItem(V3)) {
      localStorage.setItem(V3, '1')
      localStorage.setItem(KEY, 'cosmic')
    }
    const v = localStorage.getItem(KEY)
    return (BGS as string[]).includes(v ?? '') ? (v as Bg) : 'cosmic'
  } catch {
    return 'cosmic'
  }
}

export function applyBg(b: Bg = getBg()) {
  document.documentElement.setAttribute('data-bg', b)
  applyTheme() // the window bar follows (Cosmic is always dark)
}

export function setBg(b: Bg) {
  try {
    localStorage.setItem(KEY, b)
  } catch {
    /* storage blocked: applies for this visit */
  }
  applyBg(b)
}
