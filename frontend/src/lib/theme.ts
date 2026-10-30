// Theme: 'system' follows the OS; 'light'/'dark' pin it via data-theme,
// which the token overrides in tokens.css already handle.

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'planner_theme'

export function getTheme(): Theme {
  const t = localStorage.getItem(KEY)
  return t === 'light' || t === 'dark' ? t : 'system'
}

// the installed app's title bar / the phone's status bar: the wallpaper's base
const BAR = { light: '#F6E8E1', dark: '#130C13' }

export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement
  if (t === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  let meta = document.querySelector('meta[name="theme-color"]')
  if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'theme-color'); document.head.appendChild(meta) }
  meta.setAttribute('content', dark ? BAR.dark : BAR.light)
}

// following the system: the bar changes when the system theme does
window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (getTheme() === 'system') applyTheme('system') })

export function setTheme(t: Theme) {
  localStorage.setItem(KEY, t)
  applyTheme(t)
}
