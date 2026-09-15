// Supabase client — replaces the ServiceNow REST client this file used to
// be. Every export below keeps its EXACT original name/signature (Login.tsx,
// Settings.tsx, Today.tsx, App.tsx, sync/engine.ts all import from here and
// none of them changed) — only the implementation underneath points at
// Supabase instead of the SN instance now.
import { supabase, shadowEmail } from './supabase'

// supabase-js persists the session under a key it derives from the project
// URL (`sb-<project-ref>-auth-token`) — reading that directly, the same way
// the old code read its own `planner_token` key, is what keeps isAuthed()
// synchronous. App.tsx's <Guard> calls it on every render; making this
// async would mean restructuring Guard into loading/ready state instead of
// a one-line check, which the rest of this migration deliberately avoids.
const PROJECT_REF = (() => {
  try {
    return new URL(import.meta.env.VITE_SUPABASE_URL as string).hostname.split('.')[0]
  } catch {
    return ''
  }
})()
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`

export function isAuthed(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null
}

export function clearTokens() {
  localStorage.removeItem(STORAGE_KEY)
}

export async function login(username: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: shadowEmail(username),
    password,
  })
  if (error) {
    throw new Error(
      error.message === 'Invalid login credentials' ? 'Wrong username or password.' : error.message,
    )
  }
  const display = (data.user?.user_metadata?.display_name as string | undefined) ?? username
  localStorage.setItem('planner_user', display)
  return data
}

/** Registration also returns a session token, so new users land signed in.
    Supabase Auth's own unique-email constraint on the shadow email IS the
    username-uniqueness check — no separate lookup needed. */
export async function register(username: string, password: string, displayName?: string) {
  const { data, error } = await supabase.auth.signUp({
    email: shadowEmail(username),
    password,
    options: { data: { display_name: displayName ?? username } },
  })
  if (error) {
    const taken = error.status === 422 || /already/i.test(error.message)
    throw new Error(taken ? 'That username is taken.' : error.message)
  }
  localStorage.setItem('planner_user', displayName ?? username)
  return data
}

export function currentUser(): string | null {
  return localStorage.getItem('planner_user')
}

/** Works only while already signed in — no email involved at all, which is
    the whole point: the login email is a fake, never-delivered placeholder
    (see shadowEmail in ./supabase), so Supabase's own dashboard "send
    password recovery" option can never reach the user. This is the one
    real path to changing a password. */
export async function changePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw new Error(error.message)
}

/** Best-effort server logout; local cleanup is the caller's job. */
export async function serverLogout() {
  try {
    await supabase.auth.signOut()
  } catch {
    // offline or already dead — fine, we're leaving anyway
  }
}

// ---- Planner sync (Postgres functions in supabase/schema.sql) ----

export interface PushItem {
  table: string
  client_uuid: string
  payload: Record<string, unknown>
  edited_at: number
}

export interface PushResult {
  results: { client_uuid: string; sys_id: string; outcome: 'applied' | 'server_won' }[]
}

export async function syncPush(items: PushItem[]): Promise<PushResult> {
  const { data, error } = await supabase.rpc('sync_push', { items })
  if (error) throw new Error(error.message)
  return data as PushResult
}

export interface PullResponse {
  cursor: string
  records: { table: string; client_uuid: string; sys_id: string; deleted: boolean; data: Record<string, unknown> }[]
}

export async function syncPull(cursor: string): Promise<PullResponse> {
  const { data, error } = await supabase.rpc('sync_pull', { since: cursor })
  if (error) throw new Error(error.message)
  return data as PullResponse
}
