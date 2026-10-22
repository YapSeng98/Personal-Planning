// Lists that merge item by item across devices: a task's checklist (its
// steps) and its focus-timer sessions. Every item has an id and `t`, when it
// was last edited (ms). For each id the latest edit wins, wherever it was
// made; a removed item stays as {id, del: 1, t}, so the removal beats an
// older edit of it from another device. Mirrors merge_items() in
// supabase/schema.sql — a device's merged view matches what the server holds.

export interface ListItem {
  id: string
  /** Last edit, ms since epoch. */
  t: number
  /** Removed (kept so the removal syncs). */
  del?: 1
}

/** One step of a task. */
export interface CheckItem extends ListItem {
  text: string
  done?: 1
}

/** Time spent on a task on one day (a timer session; sessions over
    midnight are split per day). */
export interface FocusEntry extends ListItem {
  /** YYYY-MM-DD, local */
  d: string
  /** minutes */
  m: number
}

const time = (x: ListItem) => (typeof x.t === 'number' ? x.t : 0)

/** Merge two versions of a list item by item (see top of file). Items keep
    `cur`'s order; ones only in `inc` are added at the end. */
export function mergeItems<T extends ListItem>(cur: T[] | undefined, inc: T[] | undefined): T[] | undefined {
  if (!cur && !inc) return undefined
  const a = Array.isArray(cur) ? cur : [], b = Array.isArray(inc) ? inc : []
  const incById = new Map<string, T>()
  for (const u of b) if (!incById.has(u.id)) incById.set(u.id, u)
  const out = a.map((e) => {
    const u = incById.get(e.id)
    return u && time(u) >= time(e) ? u : e
  })
  const have = new Set(a.map((e) => e.id))
  for (const u of b) if (!have.has(u.id)) out.push(u)
  return out
}

/** The items that haven't been removed. */
export const live = <T extends ListItem>(list: T[] | undefined): T[] => (list ?? []).filter((x) => !x.del)

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)

export function addStep(list: CheckItem[], text: string): CheckItem[] {
  return [...list, { id: newId(), text: text.trim(), t: Date.now() }]
}

export function toggleStep(list: CheckItem[], id: string): CheckItem[] {
  return list.map((x) => (x.id === id ? { id: x.id, text: x.text, ...(x.done ? {} : { done: 1 as const }), t: Date.now() } : x))
}

export function renameStep(list: CheckItem[], id: string, text: string): CheckItem[] {
  return list.map((x) => (x.id === id ? { ...x, text: text.trim(), t: Date.now() } : x))
}

export function removeStep(list: CheckItem[], id: string): CheckItem[] {
  return list.map((x) => (x.id === id ? { id: x.id, text: '', del: 1 as const, t: Date.now() } : x))
}

/** A repeating task's next occurrence starts with every step unticked. The
    same on every device (ids and times kept), so two devices creating the
    occurrence write the same list. */
export function freshChecklist(list: CheckItem[] | undefined): CheckItem[] | undefined {
  const steps = live(list).map(({ id, text, t }) => ({ id, text, t }))
  return steps.length ? steps : undefined
}

/** Steps done / steps in all. */
export function stepCount(list: CheckItem[] | undefined): { done: number; all: number } {
  const steps = live(list)
  return { done: steps.filter((x) => x.done).length, all: steps.length }
}

/** YYYY-MM-DD of a moment, local time. */
function ymd(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The focus entries for a timer that ran from `start` to `end` — one per
    day it touched, so a session past midnight counts on both days. */
export function sessionEntries(start: number, end: number): FocusEntry[] {
  const out: FocusEntry[] = []
  let from = start
  while (from < end) {
    const next = new Date(from)
    next.setHours(24, 0, 0, 0)
    const to = Math.min(end, next.getTime())
    out.push({ id: newId(), d: ymd(from), m: Math.round(((to - from) / 60_000) * 10) / 10, t: end })
    from = to
  }
  return out
}

/** Removes every session (the task's "Reset" time). */
export function clearFocus(list: FocusEntry[] | undefined): FocusEntry[] | undefined {
  if (!list?.length) return list
  const now = Date.now()
  return list.map((x) => (x.del ? x : { id: x.id, d: x.d, m: 0, del: 1 as const, t: now }))
}

interface Timed {
  actualHours?: number
  focusLog?: FocusEntry[]
  due?: string
  completedAt?: number
}

/** Hours spent on a task. Sessions merge across devices item by item, so
    they're the surest count; actualHours (one total) also covers time from
    before sessions were kept, and from app versions that don't keep them. */
export function spentHours(task: Timed): number {
  const logged = live(task.focusLog).reduce((n, x) => n + (x.m || 0), 0) / 60
  return Math.max(task.actualHours ?? 0, logged)
}

/** Minutes spent per day. Time the sessions don't account for (timed
    before sessions were kept) counts on the day the task was done, else on
    its due date. */
export function minutesByDay(task: Timed): Map<string, number> {
  const out = new Map<string, number>()
  let logged = 0
  for (const x of live(task.focusLog)) {
    out.set(x.d, (out.get(x.d) ?? 0) + (x.m || 0))
    logged += x.m || 0
  }
  const rest = (task.actualHours ?? 0) * 60 - logged
  const day = task.completedAt ? ymd(task.completedAt) : task.due
  if (rest > 0.5 && day) out.set(day, (out.get(day) ?? 0) + rest)
  return out
}
