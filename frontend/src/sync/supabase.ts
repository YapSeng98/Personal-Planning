import { createClient } from '@supabase/supabase-js'

// The anon key is meant to be public (it ships in every client bundle) —
// Row-Level Security on every table is the real access boundary, not
// secrecy of this key. See supabase/schema.sql.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — check frontend/.env.local')
}

export const supabase = createClient(url, anonKey)

/** Login stays username-based (the app has no email field) — Supabase Auth
    is email-based internally, so every username maps to a deterministic,
    never-shown, non-deliverable shadow address. This IS the username
    uniqueness check: auth.users' own unique-email constraint rejects a
    duplicate username for free.

    The domain deliberately does NOT use an IANA reserved special-use TLD
    (.internal, .invalid, .local, .test) — GoTrue's email validator rejects
    those outright ("Email address ... is invalid"), confirmed live against
    this project. An ordinary, unreserved-looking TLD passes validation;
    nothing is ever actually sent there (email confirmation is off). */
export function shadowEmail(username: string): string {
  return `${username.trim().toLowerCase()}@planner-account.com`
}
