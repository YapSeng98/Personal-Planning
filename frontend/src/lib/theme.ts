// Theme: 'system' follows the OS; 'light'/'dark' pin it via data-theme,
// which the token overrides in tokens.css already handle.

export type Theme = 'system' | 'light' | 'dark'

const KEY = 'planner_theme'

export function getTheme(): Theme {
  const t = localStorage.getItem(KEY)
  return t === 'light' || t === 'dark' ? t : 'system'
}

export function applyTheme(t: Theme = getTheme()) {
  const root = document.documentElement
  if (t === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', t)
}

export function setTheme(t: Theme) {
  localStorage.setItem(KEY, t)
  applyTheme(t)
}
