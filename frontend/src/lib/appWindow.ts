import { useEffect, useState, type MouseEvent } from 'react'
import { DAILY_BRIEF_URL } from './tasks'

/** One of the owner's other web apps (the quick apps on Today, Daily Brief),
    opened in a window over the Planner by components/AppWindow.tsx. */
export interface WebApp {
  url: string
  title: string
  icon: string
  color?: string
}

/** The quick apps (Today's bubbles, and the window's "+" menu). */
export const QUICK_APPS = [
  { id: 'biz', url: 'https://yapseng98.github.io/personal_business/#/', icon: '💼', color: 'var(--project-blue)', labelKey: 'today.bizLink' },
  { id: 'money', url: 'https://yapseng98.github.io/Personal-Money-Tracker/', icon: '💰', color: 'var(--project-teal)', labelKey: 'today.moneyLink' },
  { id: 'love', url: 'https://yapseng98.github.io/Love-Points-Tracker/?fresh=1785915091776', icon: '🎮', color: 'var(--project-purple)', labelKey: 'today.gameLink' },
  { id: 'kms', url: 'https://yapseng98.github.io/Knowledge_Management_System/', icon: '📚', color: 'var(--ok)', labelKey: 'today.kmsLink' },
  { id: 'trading', url: 'https://yapseng98.github.io/trading_pages/report.html', icon: '📈', color: 'var(--amber)', labelKey: 'today.tradingLink' },
  { id: 'brief', url: DAILY_BRIEF_URL, icon: '📋', color: 'var(--accent)', labelKey: 'today.briefLink' },
] as const
export type QuickApp = (typeof QUICK_APPS)[number]

// The ones turned off in Settings (stored as "hidden", so an app added
// later shows until you turn it off) — per device, like how they open.
const HIDDEN = 'planner_apps_hidden'
const APPS_CHANGED = 'planner:apps-changed'

function hiddenIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(HIDDEN) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function shownApps(): QuickApp[] {
  const hidden = hiddenIds()
  return QUICK_APPS.filter((a) => !hidden.includes(a.id))
}

export function setAppShown(id: string, on: boolean): void {
  const hidden = hiddenIds().filter((x) => x !== id)
  try {
    localStorage.setItem(HIDDEN, JSON.stringify(on ? hidden : [...hidden, id]))
  } catch {
    /* storage blocked */
  }
  window.dispatchEvent(new CustomEvent(APPS_CHANGED))
}

/** The quick apps ticked in Settings, kept up to date. */
export function useShownApps(): QuickApp[] {
  const [apps, setApps] = useState(shownApps)
  useEffect(() => {
    const on = () => setApps(shownApps())
    window.addEventListener(APPS_CHANGED, on)
    return () => window.removeEventListener(APPS_CHANGED, on)
  }, [])
  return apps
}

export const OPEN_APP = 'planner:open-app'
export const openApp = (app: WebApp) => window.dispatchEvent(new CustomEvent<WebApp>(OPEN_APP, { detail: app }))

const PREF = 'planner_apps_open'

/** Quick apps open in the window, or in a browser tab as before — per
    device (Settings). The window is the default. */
export function appsInWindow(): boolean {
  try {
    return localStorage.getItem(PREF) !== 'tab'
  } catch {
    return true
  }
}

export function setAppsInWindow(on: boolean): void {
  try {
    localStorage.setItem(PREF, on ? 'window' : 'tab')
  } catch {
    /* storage blocked: stays on the default */
  }
}

/** For a link to an app (`<a href target="_blank">`): a plain click opens it
    in the window instead. Ctrl/⌘/Shift-click and the middle button still
    open a tab, as links always do — and so does every click when Settings
    says "New tab". */
export function openAppFromClick(e: MouseEvent, app: WebApp): void {
  if (!appsInWindow() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  openApp(app)
}
