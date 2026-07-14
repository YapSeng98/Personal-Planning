// ServiceNow client — the Planner's own standalone auth (pattern borrowed
// from the Money Tracker, but nothing shared): the Planner app's
// /auth/login issues a session token; every call carries it as
// X-Planner-Token. Endpoints set CORS headers in-script and have
// "Requires authentication" = false, so no OAuth and no CORS rules.
//
// Dev: relative paths → Vite proxy. Prod: straight to the instance
// (the endpoints send CORS headers themselves).
const BASE =
  import.meta.env.VITE_SN_BASE ??
  (import.meta.env.DEV ? '' : 'https://dev405150.service-now.com')
// The Planner app's scope on the instance (Studio shows it after the app
// is created; override with VITE_SN_SCOPE if it differs).
const SCOPE = import.meta.env.VITE_SN_SCOPE ?? 'x_887486_persona_0'
const PLANNER = `/api/${SCOPE}/pps`

const TOKEN_KEY = 'planner_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
}

export function isAuthed(): boolean {
  return getToken() !== null
}

/** Unwrap ServiceNow's {result:{…}} nesting (sometimes doubled). */
function unwrap(json: unknown): Record<string, unknown> {
  let data = json as Record<string, unknown>
  if (data && typeof data === 'object' && 'result' in data) data = data.result as Record<string, unknown>
  if (data && typeof data === 'object' && 'result' in data) data = data.result as Record<string, unknown>
  return data
}

async function call(
  base: string,
  path: string,
  method: 'GET' | 'POST',
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-HTTP-Method': method,
  }
  const token = getToken()
  if (token) headers['X-Planner-Token'] = token

  let url = `${BASE}${base}${path}`
  const init: RequestInit = { method, headers }
  if (body) {
    if (method === 'GET') {
      const qs = Object.entries(body)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
      if (qs) url += (url.includes('?') ? '&' : '?') + qs
    } else {
      init.body = JSON.stringify(body)
    }
  }

  const res = await fetch(url, init)
  const json = await res.json().catch(() => ({}))
  const data = unwrap(json)
  if (!res.ok || (data && typeof data.error === 'string')) {
    const msg =
      (data && (data.error as string)) ||
      (json?.error?.message as string) ||
      `${method} ${path} → ${res.status}`
    if (res.status === 401) clearTokens()
    throw new Error(msg)
  }
  return data
}

export async function login(username: string, password: string) {
  const data = await call(PLANNER, '/auth/login', 'POST', { username, password })
  const token = data.token as string | undefined
  if (!token) throw new Error('Sign-in failed — no session token returned.')
  localStorage.setItem(TOKEN_KEY, token)
  return data
}

/** Registration also returns a session token, so new users land signed in. */
export async function register(username: string, password: string, displayName?: string) {
  const data = await call(PLANNER, '/auth/register', 'POST', {
    username,
    password,
    display_name: displayName ?? username,
  })
  const token = data.token as string | undefined
  if (token) localStorage.setItem(TOKEN_KEY, token)
  return data
}

// ---- Planner sync endpoints (servicenow/scripted-rest/) ----

export interface PushItem {
  table: string
  client_uuid: string
  payload: Record<string, unknown>
  edited_at: number
}

export interface PushResult {
  results: { client_uuid: string; sys_id: string; outcome: 'applied' | 'server_won' }[]
}

export function syncPush(items: PushItem[]): Promise<PushResult> {
  return call(PLANNER, '/sync/push', 'POST', { items }) as Promise<unknown> as Promise<PushResult>
}

export interface PullResponse {
  cursor: string
  records: { table: string; client_uuid: string; sys_id: string; deleted: boolean; data: Record<string, unknown> }[]
}

export function syncPull(cursor: string): Promise<PullResponse> {
  return call(PLANNER, '/sync/pull', 'GET', { since: cursor }) as Promise<unknown> as Promise<PullResponse>
}

export function fetchTodayDashboard() {
  return call(PLANNER, '/dashboard/today', 'GET')
}
