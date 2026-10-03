// Thin client for the Planner AI proxy (see ai-proxy/worker.js). The proxy URL
// is per-user infra, set in Settings. When it's not configured, aiEnabled() is
// false and the app stays fully rule-based.
//
// localStorage is the working copy (aiEnabled() is called synchronously all
// over the UI); the account's Supabase user_metadata.ai_url is the shared
// copy, so setting it once in Settings turns AI on for every signed-in device.

import { supabase } from '../sync/supabase'
import { isAuthed } from '../sync/api'

const KEY = 'planner_ai_url'
const META = 'ai_url'
let pushTimer: number | undefined

export function getAiUrl(): string {
  return localStorage.getItem(KEY) ?? ''
}
function setLocal(u: string) {
  if (u) localStorage.setItem(KEY, u)
  else localStorage.removeItem(KEY)
}
export function setAiUrl(url: string) {
  const u = url.trim()
  setLocal(u)
  // Settings calls this per keystroke — push once typing settles.
  if (!isAuthed()) return
  window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => {
    pushTimer = undefined
    supabase.auth.updateUser({ data: { [META]: u } }).catch(() => {})
  }, 1000)
}

/** Adopt the account's AI URL on this device (called from each sync). If the
    account has none yet but this device does — set up before syncing
    existed — upload it instead. Returns true when the local value changed. */
export async function syncAiUrl(): Promise<boolean> {
  if (!isAuthed() || pushTimer !== undefined) return false // local edit pending
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return false
  const meta = data.user.user_metadata ?? {}
  const local = getAiUrl()
  if (!(META in meta)) {
    if (local) await supabase.auth.updateUser({ data: { [META]: local } })
    return false
  }
  const remote = String(meta[META] ?? '')
  if (remote === local || pushTimer !== undefined) return false
  setLocal(remote)
  return true
}
export function aiEnabled(): boolean {
  return getAiUrl().length > 0
}

/** POST a prompt to the proxy; returns the model's text. Throws on failure. */
export async function askAI(prompt: string, system?: string, signal?: AbortSignal): Promise<string> {
  const url = getAiUrl()
  if (!url) throw new Error('AI not configured')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, system }),
    signal,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || typeof data.text !== 'string') {
    throw new Error(data?.error || `AI request failed (${res.status})`)
  }
  return data.text.trim()
}

/** Thrown by askAIJson when the model's reply couldn't be read as JSON (e.g. a
    reasoning model padded its answer with chain-of-thought, or got cut off
    before finishing). Callers should catch this specifically to show their
    own translated "try again" message — any other error passes through with
    its real message (bad key, rate limit, etc). */
export const AI_FORMAT_ERROR = 'AI_FORMAT_ERROR'

/** Like askAI, but extracts and parses a JSON object from the reply. `system`
    should already tell the model to reply with nothing but that object (see
    existing call sites for the phrasing) — this only handles a model padding
    the reply with stray text around the braces, or failing outright. */
export async function askAIJson<T = Record<string, unknown>>(prompt: string, system: string, signal?: AbortSignal): Promise<T> {
  const text = await askAI(prompt, system, signal)
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) throw new Error(AI_FORMAT_ERROR)
  try {
    return JSON.parse(text.slice(start, end + 1)) as T
  } catch {
    throw new Error(AI_FORMAT_ERROR)
  }
}
