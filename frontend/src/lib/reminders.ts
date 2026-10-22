// Reminders when a task's time block starts (Settings → Reminders, per device).
//
// • While the app is open — any tab, or in the background on a computer —
//   it checks here every 20 seconds: a banner in the app if you're looking
//   at it, otherwise a system notification.
// • When it's closed: push notifications from the server (schema.sql:
//   send_due_reminders → the push-reminders Edge Function), once this device
//   has registered for them (enablePush) and the one-time server setup
//   (supabase/push_setup.sql) is done.
//
// Each block's tag ("block:<task or series id>:<YYYY-MM-DDTHH:MM>") is the
// same here and on the server, so a reminder shown by the app and then
// pushed replaces itself instead of showing twice.

import { db, todayStr, addDays, uuidFrom, activeRecurringSeries, isProjectedOccurrence, CHANGED } from '../db/db'
import { supabase } from '../sync/supabase'
import { isAuthed, syncSession } from '../sync/api'
import { runningTimer } from './timer'
import { tr, getLang } from './i18n'

/** Public half of the push key (VAPID). The private half lives only in the
    database's Vault (push_setup.sql); the Edge Function sends only for it. */
export const VAPID_PUBLIC_KEY = 'BC6fnTha5LG_C6l5AHclqDHqZfFb-XG50a9JaxTFh2drfxi8fKybnJi5o5Ue6OVIVvhuTJm08Kb-Zy_u_3zRwR0'

/** How early to remind, minutes before the block starts. */
export const LEADS = [0, 5, 10, 15, 30]

export interface ReminderPrefs {
  on: boolean
  lead: number
}

const PREFS = 'planner_reminders'
const FIRED = 'planner_reminded'
/** Sent up to this late (the app was asleep when the block started). */
const GRACE = 10 * 60_000

export function reminderPrefs(): ReminderPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS) ?? 'null') as Partial<ReminderPrefs> | null
    return { on: !!v?.on, lead: LEADS.includes(Number(v?.lead)) ? Number(v!.lead) : 0 }
  } catch {
    return { on: false, lead: 0 }
  }
}

export function setReminderPrefs(p: ReminderPrefs) {
  localStorage.setItem(PREFS, JSON.stringify(p))
  refresh()
}

/** A time block to remind about. */
export interface Reminder {
  tag: string
  /** undefined: a repeat whose row for that day doesn't exist yet */
  taskId?: string
  title: string
  /** YYYY-MM-DDTHH:MM, local */
  start: string
  end?: string
}

/** "09:00–10:00 · Starts now" */
export function reminderBody(r: Reminder, lead: number): string {
  const time = r.start.slice(11, 16) + (r.end ? `–${r.end.slice(11, 16)}` : '')
  return `${time} · ${lead > 0 ? tr('rem.startsIn', { n: lead }) : tr('rem.startsNow')}`
}

const localMs = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  const [h, mi] = s.slice(11, 16).split(':').map(Number)
  return new Date(y, m - 1, d, h, mi).getTime()
}

/** Today's and tomorrow's blocks still to do — including repeats whose row
    for that day a device hasn't created yet (the server reminds for those
    too, see due_reminders in schema.sql). */
export async function upcomingBlocks(): Promise<Reminder[]> {
  const today = todayStr(), tomorrow = addDays(today, 1)
  const rows = await db.tasks.where('due').between(today, tomorrow, true, true)
    .and((x) => !x.deleted && !!x.timeBlockStart).toArray()
  const out: Reminder[] = rows
    .filter((x) => x.state === 'open' || x.state === 'in_progress')
    .map((x) => ({
      tag: `block:${x.seriesId ?? x.id}:${x.timeBlockStart!.slice(0, 16)}`,
      taskId: x.id, title: x.title, start: x.timeBlockStart!.slice(0, 16), end: x.timeBlockEnd?.slice(0, 16),
    }))
  for (const latest of await activeRecurringSeries()) {
    if (!latest.timeBlockStart) continue
    for (const day of [today, tomorrow]) {
      if (!isProjectedOccurrence(latest, day)) continue
      // created already (or deleted): the row above decides
      if (await db.tasks.get(await uuidFrom(`${latest.seriesId}:${day}`))) continue
      const start = `${day}T${latest.timeBlockStart.slice(11, 16)}`
      out.push({
        tag: `block:${latest.seriesId}:${start}`, title: latest.title, start,
        end: latest.timeBlockEnd ? `${day}T${latest.timeBlockEnd.slice(11, 16)}` : undefined,
      })
    }
  }
  return out
}

function firedTags(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FIRED) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}

/** Show a reminder: in the app if it's in front of you, else as a notification. */
async function show(r: Reminder, lead: number) {
  if (document.visibilityState === 'visible' && document.hasFocus()) {
    window.dispatchEvent(new CustomEvent<Reminder>('planner:reminder', { detail: r }))
    return
  }
  await notify(r.title, reminderBody(r, lead), r.tag)
}

/** A system notification (through the service worker where there is one —
    the only way on phones). False if this device can't or won't show it. */
export async function notify(title: string, body: string, tag: string): Promise<boolean> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return false
  const url = location.href.split('#')[0] + '#/'
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.showNotification(title, { body, tag, data: { url } })
      return true
    }
    new Notification(title, { body, tag })
    return true
  } catch {
    return false
  }
}

let blocks: Reminder[] = []
let loading: Promise<void> | null = null

async function refreshBlocks() {
  loading ??= upcomingBlocks().then((b) => { blocks = b }).catch(() => {}).finally(() => { loading = null })
  await loading
}

/** Remind about any block whose time has come (each once per device, also
    across tabs: the fired tags are shared in localStorage). */
async function check() {
  const p = reminderPrefs()
  if (!p.on) return
  const now = Date.now()
  const fired = firedTags()
  for (const k of Object.keys(fired)) if (now - fired[k] > 3 * 86400_000) delete fired[k]
  const due = blocks.filter((r) => {
    const at = localMs(r.start) - p.lead * 60_000
    return now >= at && now - at < GRACE && !fired[r.tag]
  })
  if (!due.length) return
  for (const r of due) fired[r.tag] = now
  localStorage.setItem(FIRED, JSON.stringify(fired))
  const timing = runningTimer()?.taskId
  for (const r of due) if (!r.taskId || r.taskId !== timing) await show(r, p.lead)
}

function refresh() {
  // nothing to read when reminders are off on this device
  if (reminderPrefs().on) refreshBlocks().then(check)
}

let started = false
export function startReminderLoop() {
  if (started) return
  started = true
  refresh()
  window.addEventListener(CHANGED, refresh)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh() })
  window.setInterval(check, 20_000)
  // a new day's blocks (and repeats), even if nothing changed
  window.setInterval(refresh, 10 * 60_000)
  window.setTimeout(() => registerPushQuietly(), 5000)
}

// ---------------------------------------------------------------- push

export type PushResult = 'ok' | 'unsupported' | 'install' | 'denied' | 'signed-out' | 'no-server' | 'error'

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

/** Can this device get notifications at all? 'install': iPhone/iPad only
    once the app is on the Home Screen. */
export function notifySupport(): 'ok' | 'install' | 'unsupported' {
  if ('Notification' in window && 'serviceWorker' in navigator) return 'ok'
  return isIOS() && !standalone() ? 'install' : 'unsupported'
}

const pushable = () => 'serviceWorker' in navigator && 'PushManager' in window

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

const sameKey = (a: ArrayBuffer | null | undefined, b: Uint8Array) =>
  !!a && a.byteLength === b.length && new Uint8Array(a).every((x, i) => x === b[i])

/** Register this device for reminders while the app is closed (asks for
    permission if it hasn't been given). */
export async function enablePush(): Promise<PushResult> {
  const support = notifySupport()
  if (support !== 'ok') return support
  if (Notification.permission === 'default') await Notification.requestPermission()
  if (Notification.permission !== 'granted') return 'denied'
  if (!pushable()) return isIOS() && !standalone() ? 'install' : 'unsupported'
  if (!isAuthed()) return 'signed-out'
  try {
    const reg = await navigator.serviceWorker.ready
    const key = keyBytes(VAPID_PUBLIC_KEY)
    let sub = await reg.pushManager.getSubscription()
    // made for another key: of no use to this server
    if (sub && !sameKey(sub.options.applicationServerKey, key)) {
      await sub.unsubscribe()
      sub = null
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    const j = sub.toJSON()
    const sess = await syncSession()
    if (!sess) return 'signed-out'
    const { error } = await supabase.rpc('save_push_subscription', {
      sub: {
        endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone, lang: getLang(), lead: reminderPrefs().lead,
      },
    }).setHeader('Authorization', `Bearer ${sess.token}`)
    if (error) return /PGRST202|does not exist|Could not find the function/i.test(`${error.code} ${error.message}`) ? 'no-server' : 'error'
    localStorage.setItem('planner_push_seen', todayStr())
    return 'ok'
  } catch {
    return 'error'
  }
}

/** Stop push reminders on this device (turning them off, signing out). */
export async function disablePush(): Promise<void> {
  if (!pushable()) return
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    const sess = isAuthed() ? await syncSession() : null
    if (sess) await supabase.rpc('delete_push_subscription', { endpoint: sub.endpoint }).setHeader('Authorization', `Bearer ${sess.token}`)
    await sub.unsubscribe()
  } catch {
    // nothing more to do: the server forgets devices it can't reach
  }
  localStorage.removeItem('planner_push_seen')
}

/** Keep this device's registration fresh (once a day): the server forgets
    devices it hasn't heard from in 60 days, and the time zone may change. */
export function registerPushQuietly(force = false) {
  const p = reminderPrefs()
  if (!p.on || !pushable() || !isAuthed() || !('Notification' in window) || Notification.permission !== 'granted') return
  if (!force && localStorage.getItem('planner_push_seen') === todayStr()) return
  enablePush().catch(() => {})
}

export interface ServerStatus {
  /** schema.sql has the reminder functions */
  db: boolean
  /** push_setup.sql run: the key is in Vault, the timer runs */
  setup: boolean
  /** the Edge Function answers: true, 'jwt' = deployed but checking sign-ins */
  fn: boolean | 'jwt'
}

/** Whether the server side of closed-app reminders is ready. */
export async function serverStatus(): Promise<ServerStatus> {
  const out: ServerStatus = { db: false, setup: false, fn: false }
  const sess = isAuthed() ? await syncSession() : null
  if (sess) {
    const { data, error } = await supabase.rpc('push_status').setHeader('Authorization', `Bearer ${sess.token}`)
    if (!error && data) {
      out.db = true
      const d = data as { key?: boolean; timer?: boolean }
      out.setup = !!d.key && !!d.timer
    }
  }
  try {
    const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/push-reminders`)
    if (r.status === 401) out.fn = 'jwt'
    else if (r.ok) out.fn = ((await r.json()) as { planner?: number }).planner === 1
  } catch {
    out.fn = false
  }
  return out
}
