// Live sync: instead of waiting for the 60s poll, listen on Supabase
// Realtime for this user's row in sync_signals (bumped by a trigger on
// every synced table — see supabase/schema.sql) and pull right away. Our
// own pushes bump it too; the resulting pull is cheap and harmless.
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { isAuthed } from './api'

let channel: RealtimeChannel | null = null
let starting = false
let timer: number | undefined

/** Idempotent — the sync engine calls it on every sync, so signing in after
    the app started still connects. */
export async function startLiveSync(onSignal: () => void) {
  if (channel || starting || !isAuthed()) return
  starting = true
  try {
    await subscribe(onSignal)
  } finally {
    starting = false
  }
}

async function subscribe(onSignal: () => void) {
  const { data } = await supabase.auth.getSession()
  const uid = data.session?.user.id
  if (!uid) return
  // Realtime authorises postgres_changes with the user's JWT (RLS applies).
  supabase.realtime.setAuth(data.session!.access_token)
  channel = supabase
    .channel(`sync:${uid}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sync_signals', filter: `user_id=eq.${uid}` }, () => {
      // A burst of saves elsewhere arrives as several signals — pull once.
      window.clearTimeout(timer)
      timer = window.setTimeout(onSignal, 400)
    })
    .subscribe()
}

export function stopLiveSync() {
  if (channel) supabase.removeChannel(channel)
  channel = null
}
