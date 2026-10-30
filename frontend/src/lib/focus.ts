// Focus mode — the full-screen timer (components/FocusMode.tsx). It runs on
// the task timer (lib/timer.ts): a focus round IS the timer running, so every
// round lands in the task's sessions and in Stats like any other timing. On
// top it keeps the round plan — free (counts up), 25/5 or 50/10 (Pomodoro:
// four rounds, then a long break) — on this device (localStorage), worked
// out from timestamps: a round that ended while the app was closed is
// recorded up to its end, not up to when you came back.
import { useEffect, useState } from 'react'
import { db, todayStr, patchAndQueue, rollUpGoal, nextCompletedAt } from '../db/db'
import { syncNow } from '../sync/engine'
import { runningTimer, startTimer, stopTimer } from './timer'
import { live, minutesByDay } from './items'
import { notify } from './reminders'
import { tr } from './i18n'

export type Plan = 'free' | '25' | '50'
export const PLANS = {
  '25': { focus: 25, rest: 5, long: 15 },
  '50': { focus: 50, rest: 10, long: 20 },
} as const
export const ROUNDS = 4

export interface Focus {
  taskId: string
  title: string
  plan: Plan
  /** ready: a break is over, the next round waits for you */
  phase: 'focus' | 'break' | 'ready'
  /** 1 … ROUNDS */
  round: number
  /** when the running round / break ends (a free round has no end) */
  endsAt?: number
  /** paused: ms left of the round / break */
  left?: number
  /** a free round: ms counted before the timer's current run */
  acc?: number
  paused?: boolean
}

/** What just happened, for the screen (celebration) and the chime. */
export type FocusEvent =
  | { kind: 'complete'; min: number; rest: number; long: boolean }
  | { kind: 'break-over'; round: number }
  | { kind: 'task-done'; title: string }

const KEY = 'planner_focus'
const PLAN_KEY = 'planner_focus_plan'
export const FOCUS_EVENT = 'planner:focus-event'

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const announce = (e: FocusEvent) => window.dispatchEvent(new CustomEvent<FocusEvent>(FOCUS_EVENT, { detail: e }))

export function focusState(): Focus | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Focus | null
    return v && v.taskId && v.phase ? v : null
  } catch {
    return null
  }
}
function save(f: Focus | null) {
  if (f) localStorage.setItem(KEY, JSON.stringify(f))
  else localStorage.removeItem(KEY)
  emit()
}

export function lastPlan(): Plan {
  const v = localStorage.getItem(PLAN_KEY)
  return v === 'free' || v === '50' ? v : '25'
}

const focusMs = (plan: Plan) => (plan === 'free' ? 0 : PLANS[plan].focus * 60_000)

/** ms into the current round (focus phase). */
export function roundElapsed(f: Focus, now = Date.now()): number {
  const t = runningTimer()
  const run = !f.paused && t?.taskId === f.taskId ? now - t.startedAt : 0
  if (f.plan === 'free') return (f.acc ?? 0) + run
  const left = f.paused ? (f.left ?? 0) : (f.endsAt ?? now) - now
  return focusMs(f.plan) - left
}

/** ms left of the running / paused round or break (Pomodoro). */
export function remaining(f: Focus, now = Date.now()): number {
  if (f.paused) return Math.max(0, f.left ?? 0)
  return Math.max(0, (f.endsAt ?? now) - now)
}

/** Length of the current round or break, ms. */
export function phaseLength(f: Focus): number {
  if (f.plan === 'free') return 0
  const p = PLANS[f.plan]
  if (f.phase === 'break') return (f.round >= ROUNDS ? p.long : p.rest) * 60_000
  return p.focus * 60_000
}

/** Focus on a task: starts its timer and the round plan. The same task
    already in focus carries on; another one is wrapped up first (its time
    saved). */
export async function beginFocus(task: { id: string; title: string }, plan: Plan = lastPlan()): Promise<void> {
  const cur = focusState()
  if (cur?.taskId === task.id) return
  if (cur) await endFocus()
  await startTimer(task)
  const now = Date.now()
  save({ taskId: task.id, title: task.title, plan, phase: 'focus', round: 1, endsAt: plan === 'free' ? undefined : now + focusMs(plan), acc: 0 })
}

export async function pauseFocus(): Promise<void> {
  const f = focusState()
  if (!f || f.paused || f.phase === 'ready') return
  const now = Date.now()
  if (f.phase === 'focus') {
    const acc = f.plan === 'free' ? roundElapsed(f, now) : undefined
    const left = f.plan === 'free' ? undefined : remaining(f, now)
    // paused first: a check running meanwhile must not read the stopped
    // timer as "stopped somewhere else" and end focus mode
    save({ ...f, paused: true, acc, left, endsAt: undefined })
    await stopTimer(now)
  } else {
    save({ ...f, paused: true, left: remaining(f, now), endsAt: undefined })
  }
}

export async function resumeFocus(): Promise<void> {
  const f = focusState()
  if (!f || !f.paused) return
  const now = Date.now()
  if (f.phase === 'focus') await startTimer({ id: f.taskId, title: f.title })
  save({ ...f, paused: false, left: undefined, endsAt: f.plan === 'free' && f.phase === 'focus' ? undefined : now + (f.left ?? 0) })
}

/** The next round — after a break, or skipping it. */
export async function nextRound(): Promise<void> {
  const f = focusState()
  if (!f) return
  // skipping a break moves on to the next round, as its end would have
  const round = f.phase === 'break' ? (f.round >= ROUNDS ? 1 : f.round + 1) : f.round
  await startTimer({ id: f.taskId, title: f.title })
  save({ ...f, phase: 'focus', round, paused: false, left: undefined, acc: 0, endsAt: f.plan === 'free' ? undefined : Date.now() + focusMs(f.plan) })
}

/** Switch free / 25 / 50 — a round under way keeps the time it has done. */
export async function setPlan(plan: Plan): Promise<void> {
  localStorage.setItem(PLAN_KEY, plan)
  const f = focusState()
  if (!f || f.plan === plan) { emit(); return }
  if (f.phase !== 'focus') {
    // a free round has no breaks: one under way ends, the next round waits
    save(plan === 'free' ? { ...f, plan, phase: 'ready', round: 1, endsAt: undefined, left: undefined, paused: false } : { ...f, plan })
    return
  }
  const now = Date.now()
  const done = roundElapsed(f, now)
  const t = runningTimer()
  const run = !f.paused && t?.taskId === f.taskId ? now - t.startedAt : 0
  if (plan === 'free') {
    save({ ...f, plan, round: 1, acc: done - run, endsAt: undefined, left: undefined })
  } else {
    const left = Math.max(0, focusMs(plan) - done)
    save({ ...f, plan, acc: 0, ...(f.paused ? { left } : { endsAt: now + left }) })
  }
  await settleFocus()
}

/** Stop: the time so far is saved, focus mode ends. */
export async function endFocus(): Promise<void> {
  const f = focusState()
  save(null)
  if (f && runningTimer()?.taskId === f.taskId) await stopTimer()
}

/** Tick the task off from focus mode: its time is saved, then it's done. */
export async function finishTask(): Promise<void> {
  const f = focusState()
  if (!f) return
  await endFocus()
  const task = await db.tasks.get(f.taskId)
  if (task && !task.deleted && task.state !== 'done') {
    const saved = await patchAndQueue(db.tasks, 'task', task.id, { state: 'done', completedAt: nextCompletedAt(task.state, task.completedAt, 'done') })
    if (saved?.goalId) await rollUpGoal(saved.goalId)
  }
  syncNow()
  announce({ kind: 'task-done', title: f.title })
}

let settling = false
/** Bring the plan up to now: a round that's over is saved and its break
    starts (from when the round ended); a break that's over waits for the
    next round. Timing stopped somewhere else (the bar's Stop, the task
    ticked off) ends focus mode. */
export async function settleFocus(now = Date.now()): Promise<void> {
  if (settling) return
  settling = true
  try {
    let f = focusState()
    if (!f || f.paused) return
    if (f.phase === 'focus' && runningTimer()?.taskId !== f.taskId) { save(null); return }
    if (f.plan === 'free') return
    const p = PLANS[f.plan]
    if (f.phase === 'focus' && f.endsAt && now >= f.endsAt) {
      await stopTimer(f.endsAt)
      const long = f.round >= ROUNDS
      const rest = long ? p.long : p.rest
      f = { ...f, phase: 'break', endsAt: f.endsAt + rest * 60_000, acc: 0 }
      save(f)
      announce({ kind: 'complete', min: p.focus, rest, long })
      ding(tr('focus.notifyDone'), tr(long ? 'focus.notifyLong' : 'focus.notifyBreak', { min: p.focus, rest }))
    }
    if (f.phase === 'break' && f.endsAt && now >= f.endsAt) {
      const round = f.round >= ROUNDS ? 1 : f.round + 1
      save({ ...f, phase: 'ready', round, endsAt: undefined })
      announce({ kind: 'break-over', round })
      ding(tr('focus.notifyBreakOver'), tr('focus.notifyNext', { round, title: f.title }))
    }
  } finally {
    settling = false
  }
}

/* ---- a soft chime (and a system notification when the app is hidden) ---- */
let audio: AudioContext | null = null
/** Sound may only start after a tap: called from the tap that opens focus mode. */
export function primeSound() {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') audio.resume()
  } catch {
    /* no audio here */
  }
}
function ding(title: string, body: string) {
  if (document.hidden) { notify(title, body, 'planner-focus'); return }
  navigator.vibrate?.([120, 80, 120])
  if (!audio) return
  try {
    const t0 = audio.currentTime
    for (const [i, hz] of [660, 990].entries()) {
      const o = audio.createOscillator(), g = audio.createGain()
      o.type = 'sine'; o.frequency.value = hz
      g.gain.setValueAtTime(0.0001, t0 + i * 0.18)
      g.gain.exponentialRampToValueAtTime(0.18, t0 + i * 0.18 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.9)
      o.connect(g).connect(audio.destination)
      o.start(t0 + i * 0.18); o.stop(t0 + i * 0.18 + 1)
    }
  } catch {
    /* sound is a nicety */
  }
}

/* ---- the screen: open / minimised ---- */
let open = false
const openListeners = new Set<(o: boolean) => void>()
function setOpen(o: boolean) { open = o; openListeners.forEach((l) => l(o)) }

/** ▶ on a task: focus on it and show the screen. Without a task, show the
    screen for what's in focus now. */
export async function openFocus(task?: { id: string; title: string }): Promise<void> {
  primeSound()
  if (task) await beginFocus(task)
  else if (!focusState()) {
    // timing started some other way (an older version, a reminder): adopt it
    const t = runningTimer()
    if (!t) return
    save({ taskId: t.taskId, title: t.title, plan: 'free', phase: 'focus', round: 1, acc: 0 })
  }
  setOpen(true)
}
export const minimiseFocus = () => setOpen(false)

export function useFocusOpen(): boolean {
  const [o, setO] = useState(open)
  useEffect(() => { openListeners.add(setO); return () => { openListeners.delete(setO) } }, [])
  return o
}

/** Re-renders when focus mode changes — here or in another tab. */
export function useFocus(): Focus | null {
  const [f, setF] = useState(focusState)
  useEffect(() => {
    const on = () => setF(focusState())
    const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) on() }
    listeners.add(on)
    window.addEventListener('storage', onStorage)
    return () => { listeners.delete(on); window.removeEventListener('storage', onStorage) }
  }, [])
  return f
}

/** Minutes focused today, over every task (sessions dated today). */
export async function focusedTodayMin(): Promise<number> {
  const today = todayStr()
  const rows = await db.tasks.filter((x) => !x.deleted && (x.due === today || live(x.focusLog).some((e) => e.d === today))).toArray()
  return rows.reduce((n, x) => n + (minutesByDay(x).get(today) ?? 0), 0)
}

let started = false
/** Keep the plan up to date while the app runs (once a second, only while
    something is in focus) and as soon as it comes back to the front. */
export function startFocusLoop() {
  if (started) return
  started = true
  window.setInterval(() => { if (focusState()) settleFocus() }, 1000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settleFocus() })
  settleFocus()
}
