// Curated app backgrounds. Each is a set of soft colour glows layered over
// the theme surface (see tokens.css --app-bg), so one definition works in
// both light and dark. When a background other than 'none' is active, cards
// switch to frosted glass (backdrop blur) via the [data-bg] CSS state.

export type Bg = 'none' | 'sunrise' | 'aurora' | 'dusk' | 'ember' | 'bloom'
export const BGS: Bg[] = ['none', 'sunrise', 'aurora', 'dusk', 'ember', 'bloom']

const KEY = 'planner_bg'

export function getBg(): Bg {
  const v = localStorage.getItem(KEY)
  return (BGS as string[]).includes(v ?? '') ? (v as Bg) : 'none'
}

export function applyBg(b: Bg = getBg()) {
  document.documentElement.setAttribute('data-bg', b)
}

export function setBg(b: Bg) {
  localStorage.setItem(KEY, b)
  applyBg(b)
}
