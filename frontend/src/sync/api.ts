// ServiceNow client — OAuth2 password grant + sync endpoints (design doc §07/§08).
// In dev, paths are relative and Vite proxies them to the instance (vite.config.ts).
// In production, set VITE_SN_BASE to the instance URL and add CORS rules on SN.

const BASE = import.meta.env.VITE_SN_BASE ?? ''
const CLIENT_ID = import.meta.env.VITE_SN_CLIENT_ID ?? ''
const CLIENT_SECRET = import.meta.env.VITE_SN_CLIENT_SECRET ?? ''

// TEST MODE: Basic auth via .env.local (gitignored, local dev only) — lets the
// full app↔ServiceNow sync be verified before the OAuth flow is set up.
// Never set these in a deployed build.
const TEST_USER = import.meta.env.VITE_SN_TEST_USER ?? ''
const TEST_PASSWORD = import.meta.env.VITE_SN_TEST_PASSWORD ?? ''
export const testMode = Boolean(TEST_USER && TEST_PASSWORD)

interface Tokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

const TOKENS_KEY = 'sn_tokens'

export function getTokens(): Tokens | null {
  const raw = localStorage.getItem(TOKENS_KEY)
  return raw ? (JSON.parse(raw) as Tokens) : null
}

function saveTokens(t: Tokens) {
  localStorage.setItem(TOKENS_KEY, JSON.stringify(t))
}

export function clearTokens() {
  localStorage.removeItem(TOKENS_KEY)
}

export function isAuthed(): boolean {
  return testMode || getTokens() !== null
}

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${BASE}/oauth_token.do`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      ...body,
    }),
  })
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}). Check username and password.`)
  const json = await res.json()
  const tokens: Tokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  }
  saveTokens(tokens)
  return tokens
}

export function login(username: string, password: string) {
  return tokenRequest({ grant_type: 'password', username, password })
}

async function freshAccessToken(): Promise<string> {
  const t = getTokens()
  if (!t) throw new Error('Not signed in')
  if (Date.now() < t.expiresAt - 60_000) return t.accessToken
  const renewed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refreshToken })
  return renewed.accessToken
}

async function authFetch(path: string, init: RequestInit = {}) {
  const auth = testMode
    ? `Basic ${btoa(`${TEST_USER}:${TEST_PASSWORD}`)}`
    : `Bearer ${await freshAccessToken()}`
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: auth,
      ...init.headers,
    },
  })
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}`)
  return res.json()
}

// ---- Sync endpoints (Scripted REST, servicenow/scripted-rest/) ----

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
  return authFetch('/api/x_pps/pps/sync/push', {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

export interface PullResponse {
  cursor: string
  records: { table: string; client_uuid: string; sys_id: string; deleted: boolean; data: Record<string, unknown> }[]
}

export function syncPull(cursor: string): Promise<PullResponse> {
  return authFetch(`/api/x_pps/pps/sync/pull?since=${encodeURIComponent(cursor)}`)
}

export function fetchTodayDashboard() {
  return authFetch('/api/x_pps/pps/dashboard/today')
}
