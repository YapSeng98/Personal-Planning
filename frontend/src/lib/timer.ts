// Focus timer: time a task while you work on it; stopping adds the time to
// the task's actualHours (a synced field, so every device sees the total).
// One timer at a time. What's running is kept on this device only
// (localStorage), so it survives a reload or the app being closed.
import { useEffect, useState } from 'react'
import { db, patchAndQueue } from '../db/db'
import { syncNow } from '../sync/engine'

const KEY = 'planner_timer'

export interface RunningTimer {
  taskId: string
  title: string
  startedAt: number
}

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function runningTimer(): RunningTimer | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as RunningTimer | null
    return v && typeof v.startedAt === 'number' && v.taskId ? v : null
  } catch {
    return null
  }
}

/** Stop the running timer (if any) and add its time to that task. */
export async function stopTimer(): Promise<void> {
  const cur = runningTimer()
  if (!cur) return
  localStorage.removeItem(KEY)
  emit()
  const elapsedH = (Date.now() - cur.startedAt) / 3600_000
  // under half a minute is a mis-tap, not work
  if (elapsedH < 30 / 3600) return
  const task = await db.tasks.get(cur.taskId)
  if (!task || task.deleted) return
  // the total as stored now, so time already synced in from another device counts
  const total = Math.round(((task.actualHours ?? 0) + elapsedH) * 1000) / 1000
  await patchAndQueue(db.tasks, 'task', task.id, { actualHours: total })
  syncNow()
}

/** Start timing a task — stopping (and saving) any other timer first. */
export async function startTimer(task: { id: string; title: string }): Promise<void> {
  const cur = runningTimer()
  if (cur?.taskId === task.id) return
  if (cur) await stopTimer()
  localStorage.setItem(KEY, JSON.stringify({ taskId: task.id, title: task.title, startedAt: Date.now() } satisfies RunningTimer))
  emit()
}

/** Re-renders when a timer starts or stops — here or in another tab. */
export function useRunningTimer(): RunningTimer | null {
  const [t, setT] = useState(runningTimer)
  useEffect(() => {
    const on = () => setT(runningTimer())
    const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) on() }
    listeners.add(on)
    window.addEventListener('storage', onStorage)
    return () => { listeners.delete(on); window.removeEventListener('storage', onStorage) }
  }, [])
  return t
}

/** Seconds since `since`, ticking once a second. */
export function useElapsed(since: number | undefined): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === undefined) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [since])
  return since === undefined ? 0 : Math.max(0, Math.floor((now - since) / 1000))
}

/** 0:42 / 12:05 / 1:02:09 — a running clock. */
export function clock(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

/** 25m / 1h / 1h 20m — a duration given in hours. */
export function hm(hours: number | undefined): string {
  const min = Math.round((hours ?? 0) * 60)
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60), m = min % 60
  return m ? `${h}h ${m}m` : `${h}h`
}
