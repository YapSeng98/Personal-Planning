// Thin client for the Planner AI proxy (see ai-proxy/worker.js). The proxy URL
// is per-user infra, stored in localStorage and set in Settings. When it's not
// configured, aiEnabled() is false and the app stays fully rule-based.

const KEY = 'planner_ai_url'

export function getAiUrl(): string {
  return localStorage.getItem(KEY) ?? ''
}
export function setAiUrl(url: string) {
  const u = url.trim()
  if (u) localStorage.setItem(KEY, u)
  else localStorage.removeItem(KEY)
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
