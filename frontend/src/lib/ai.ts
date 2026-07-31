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
