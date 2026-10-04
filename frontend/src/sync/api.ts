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

/** Best-effort server logout; local cleanup is the caller's job. Only THIS
    device's session ends — supabase-js's default ('global') revoked every
    session of the account, silently signing out the user's other devices
    (their edits then stopped syncing). */
export async function serverLogout() {
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // offline or already dead — fine, we're leaving anyway
  }
}

/** Which account the data stored on this device belongs to. Signing in as a
    different account (e.g. after a session expired without logging out)
    must not show — or push — the previous account's local data. */
export const DATA_OWNER_KEY = 'planner_data_owner'
export function localDataOwner(): string | null {
  return localStorage.getItem(DATA_OWNER_KEY)
}

/** The signed-in account's id, read synchronously from the stored session
    (null when signed out). */
export function accountId(): string | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { user?: { id?: string } } | null
    return s?.user?.id ?? localDataOwner()
  } catch {
    return localDataOwner()
  }
}
export function setLocalDataOwner(uid: string | null) {
  if (uid) localStorage.setItem(DATA_OWNER_KEY, uid)
  else localStorage.removeItem(DATA_OWNER_KEY)
}

// ---- Planner sync (Postgres functions in supabase/schema.sql) ----

export interface PushItem {
  table: string
  client_uuid: string
  payload: Record<string, unknown>
  edited_at: number
  /** Field-level merge (see sync/engine.ts pushItem). Servers whose
      schema.sql predates it ignore these and use last-write-wins. */
  base_rev?: number | null
  fields?: string[] | null
  field_times?: Record<string, number>
  att_up?: string[]
  att_rm?: string[]
}

export interface PushResult {
  /** 'rejected': the id belongs to a row this account can't see.
      'server_won': only from servers whose schema.sql predates field-level
      merging (their whole-record last-write-wins kept the server's copy). */
  results: { client_uuid: string; sys_id: string; outcome: 'applied' | 'server_won' | 'rejected'; rev?: number; foreign?: boolean }[]
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

/** `cursor`: whatever the last pull returned (a database snapshot; a
    timestamp from older servers). `skip`: "<id>#<rev>" of records this
    device just pushed ("<id>:<edited_at ms>" for older servers), so the
    server doesn't send them straight back (see sync_pull in schema.sql). */
export async function syncPull(cursor: string, skip: string[] = []): Promise<PullResponse> {
  let { data, error } = await supabase.rpc('sync_pull', skip.length ? { since: cursor, skip } : { since: cursor })
  // A server whose schema.sql predates `skip` doesn't know the parameter —
  // pull without it (just re-downloads our own save, as before).
  if (error && skip.length && /sync_pull|function|schema cache/i.test(error.message)) {
    ;({ data, error } = await supabase.rpc('sync_pull', { since: cursor }))
  }
  if (error) throw new Error(error.message)
  return data as PullResponse
}
