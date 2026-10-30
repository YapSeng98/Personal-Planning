// The command bar on Today (components/AskBar.tsx): "move gym to 6pm",
// "what's overdue?", "plan my evening"… Common requests are understood here,
// in English and Chinese, with no network — so they work offline and
// without the AI. Anything else goes to the AI (lib/ai.ts) when it's set
// up, which answers and may propose the same kinds of changes.
//
// Nothing changes until you press the answer's button, and every change can
// be undone. Changes go through patchAndQueue / writeAndQueue like any edit,
// so they sync field by field.
import {
  db, todayStr, addDays, uuid, OVERDUE_DAYS, isOpenOneOff, writeAndQueue, patchAndQueue, rollUpGoal, nextCompletedAt,
  byOrder, habitStreak, type Task,
} from '../db/db'
import { syncNow } from '../sync/engine'
import { aiEnabled, askAIJson, AI_FORMAT_ERROR } from './ai'
import { parseExtras, moveTasksTo } from './tasks'
import { openFocus, focusedTodayMin } from './focus'
import { hm } from './timer'
import type { Lang, TFn } from './i18n'

/** An answer: text (**bold** marks task names) and buttons. */
export interface Reply {
  text: string
  actions?: Act[]
  /** an answer that is only a message (an error, "done") */
  tone?: 'ok' | 'muted'
}
export interface Act {
  label: string
  primary?: boolean
  /** what to show after — null closes the answer */
  run: () => Promise<Reply | null>
}

/** Today's "Plan tomorrow" sheet opens on this event. */
export const PLAN_TOMORROW = 'planner:plan-tomorrow'

interface Ctx { t: TFn; lang: Lang }

const isOpen = (x: Task) => !x.deleted && (x.state === 'open' || x.state === 'in_progress')
const b = (s: string) => `**${s.replace(/\*\*/g, '')}**`
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const minOf = (iso?: string) => (iso ? +iso.slice(11, 13) * 60 + +iso.slice(14, 16) : NaN)
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }

async function load() {
  const today = todayStr()
  const tomorrow = addDays(today, 1)
  const todayTasks = (await db.tasks.where('due').equals(today).and((x) => !x.deleted).toArray()).sort(byOrder)
  const overdue = (await db.tasks.where('due').between(addDays(today, -OVERDUE_DAYS), today, true, false).and(isOpenOneOff).toArray())
    .sort((a, c) => c.due!.localeCompare(a.due!) || byOrder(a, c))
  const tomorrowTasks = (await db.tasks.where('due').equals(tomorrow).and((x) => !x.deleted).toArray()).sort(byOrder)
  return { today, tomorrow, todayTasks, overdue, tomorrowTasks }
}
type Data = Awaited<ReturnType<typeof load>>

/** Tasks a request may mean, most likely first: today's open ones, the
    overdue, tomorrow's, then today's finished ones. */
const pool = (d: Data) => [...d.todayTasks.filter(isOpen), ...d.overdue, ...d.tomorrowTasks.filter(isOpen), ...d.todayTasks.filter((x) => !isOpen(x))]

const STOP = new Set(['the', 'my', 'a', 'an', 'to', 'task', 'on', 'for', 'of', 'and', 'with', 'please', 'it'])
const CJK = /[㐀-鿿]/

/** The tasks whose titles best match the words of a request (all the best
    ones when it's a tie — the answer then asks which). */
export function findTasks(query: string, list: Task[]): Task[] {
  const q = query.toLowerCase().replace(/[“”"'‘’.!?。！？]/g, '').trim()
  if (!q) return []
  const exact = list.filter((x) => x.title.toLowerCase().trim() === q)
  if (exact.length) return exact.slice(0, 1)
  const words = q.split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w))
  const scored = list.map((x) => {
    const tl = x.title.toLowerCase()
    let s = tl.includes(q) ? 100 : 0
    if (CJK.test(q)) {
      const chars = [...q].filter((c) => /[㐀-鿿\w]/.test(c))
      const hit = chars.filter((c) => tl.includes(c)).length
      if (chars.length && hit / chars.length >= 0.6) s += Math.round((hit / chars.length) * 50)
    } else if (words.length) {
      const hits = words.filter((w) => tl.includes(w)).length
      s += hits * 10 + (hits === words.length ? 20 : 0)
    }
    return { x, s }
  }).filter((o) => o.s > 0)
  const best = Math.max(0, ...scored.map((o) => o.s))
  const seen = new Set<string>()
  return scored.filter((o) => o.s === best && !seen.has(o.x.id) && seen.add(o.x.id)).map((o) => o.x)
}

/** "3pm", "3:30 pm", "15:00", "15.30", "下午3点", "9点半" → minutes into the day. */
export function parseTime(s: string): number | null {
  const x = s.toLowerCase()
  let m = x.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)\b/)
  if (m) {
    let h = +m[1] % 12
    if (m[3] === 'pm') h += 12
    return h < 24 && +(m[2] ?? 0) < 60 ? h * 60 + +(m[2] ?? 0) : null
  }
  m = x.match(/\b(\d{1,2})[:.](\d{2})\b/)
  if (m) return +m[1] < 24 && +m[2] < 60 ? +m[1] * 60 + +m[2] : null
  m = x.match(/(上午|早上|早|中午|下午|傍晚|晚上|晚)?\s*(\d{1,2})\s*[点點时](?:\s*(半|\d{1,2})\s*分?)?/)
  if (m) {
    let h = +m[2]
    if (m[1] && /下午|傍晚|晚/.test(m[1]) && h < 12) h += 12
    if (m[1] === '中午' && h < 6) h += 12
    const mm = m[3] === '半' ? 30 : +(m[3] ?? 0)
    return h < 24 && mm < 60 ? h * 60 + mm : null
  }
  if (/\bnoon\b|中午/.test(x)) return 12 * 60
  return null
}

const WEEK_EN = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六']
/** "today", "tomorrow", "friday", "next week", "明天", "周五", "2026-11-02" → YYYY-MM-DD. */
export function parseDay(s: string, today = todayStr()): string | null {
  const x = s.toLowerCase()
  const iso = x.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (iso) return iso[1]
  if (/day after tomorrow|后天/.test(x)) return addDays(today, 2)
  if (/\b(tomorrow|tmr|tmrw|tomorow)\b|明天|明日/.test(x)) return addDays(today, 1)
  if (/\btoday\b|\btonight\b|今天|今晚|今日/.test(x)) return today
  const dow = new Date(today + 'T00:00').getDay()
  const ahead = (target: number) => addDays(today, ((target - dow + 7) % 7) || 7)
  if (/\bnext week\b|下周$|下星期$|下礼拜$/.test(x)) return ahead(1)
  const en = x.match(/\b(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)(?:day|nesday|rsday|urday)?\b/)
  if (en) return ahead(WEEK_EN.indexOf(en[1].slice(0, 3)))
  const zh = x.match(/(?:周|星期|礼拜)([日天一二三四五六])/)
  if (zh) return ahead(zh[1] === '天' ? 0 : WEEK_ZH.indexOf(zh[1]))
  return null
}

/** Put fields back as they were before a change (the undo). */
function restorer(tasks: Task[], fields: (keyof Task)[]) {
  const before = tasks.map((x) => ({ id: x.id, patch: Object.fromEntries(fields.map((f) => [f, x[f]])) as Partial<Task> }))
  return async () => {
    for (const { id, patch } of before) await patchAndQueue(db.tasks, 'task', id, patch)
    syncNow()
  }
}

const undoAct = (c: Ctx, undo: () => Promise<void>): Act => ({
  label: c.t('ask.undo'),
  run: async () => { await undo(); return { text: c.t('ask.undone'), tone: 'muted' } },
})

function dayLabel(day: string, c: Ctx, today = todayStr()): string {
  if (day === today) return c.t('ask.today')
  if (day === addDays(today, 1)) return c.t('ask.tomorrow')
  return new Date(day + 'T00:00').toLocaleDateString(c.lang === 'zh' ? 'zh-CN' : undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/* ------------------------------------------------------------------ */
/* the changes a command can make                                      */

/** Move a task to a day and/or a time, keeping its length. */
async function applyMove(task: Task, day: string | null, at: number | null) {
  const to = day ?? task.due ?? todayStr()
  const patch: Partial<Task> = {}
  if (day && day !== task.due) {
    patch.due = day
    const there = await db.tasks.where('due').equals(day).and((x) => !x.deleted).toArray()
    patch.sortOrder = Math.max(-1, ...there.map((x) => x.sortOrder ?? 0)) + 1
  }
  const s = minOf(task.timeBlockStart), e = minOf(task.timeBlockEnd)
  const len = !isNaN(s) && !isNaN(e) && e > s ? e - s : task.estimatedHours ? Math.round(task.estimatedHours * 60) : 0
  if (at !== null) {
    patch.timeBlockStart = `${to}T${hhmm(at)}`
    patch.timeBlockEnd = len ? `${to}T${hhmm(Math.min(at + len, 23 * 60 + 59))}` : undefined
  } else if (patch.due) {
    if (task.timeBlockStart) patch.timeBlockStart = to + task.timeBlockStart.slice(10, 16)
    if (task.timeBlockEnd) patch.timeBlockEnd = to + task.timeBlockEnd.slice(10, 16)
  }
  await patchAndQueue(db.tasks, 'task', task.id, patch)
}

async function applyDone(task: Task) {
  const saved = await patchAndQueue(db.tasks, 'task', task.id, { state: 'done', completedAt: nextCompletedAt(task.state, task.completedAt, 'done') })
  if (saved?.goalId) await rollUpGoal(saved.goalId)
}

async function applyAdd(title: string, day: string, at: number | null, hours?: number): Promise<string> {
  const there = await db.tasks.where('due').equals(day).and((x) => !x.deleted).toArray()
  const id = uuid()
  await writeAndQueue(db.tasks, 'task', {
    id, title, state: 'open', priority: 3, due: day,
    timeBlockStart: at !== null ? `${day}T${hhmm(at)}` : undefined,
    timeBlockEnd: at !== null && hours ? `${day}T${hhmm(Math.min(at + Math.round(hours * 60), 23 * 60 + 59))}` : undefined,
    estimatedHours: hours,
    sortOrder: Math.max(-1, ...there.map((x) => x.sortOrder ?? 0)) + 1,
    deleted: 0, updatedAt: Date.now(),
  })
  return id
}

/* ------------------------------------------------------------------ */
/* the commands                                                         */

/** When the request names a task that several match: ask which. */
function pick(c: Ctx, tasks: Task[], then: (x: Task) => Promise<Reply>): Reply {
  return {
    text: c.t('ask.which'),
    actions: tasks.slice(0, 4).map((x) => ({ label: x.title, run: () => then(x) })),
  }
}

function moveReply(c: Ctx, task: Task, day: string | null, at: number | null): Reply {
  if (day && day !== task.due && (task.recurrence || task.seriesId)) return { text: c.t('ask.repeatDay', { title: b(task.title) }), tone: 'muted' }
  const where = [day && day !== task.due ? dayLabel(day, c) : '', at !== null ? hhmm(at) : ''].filter(Boolean).join(' ')
  const from = task.timeBlockStart ? task.timeBlockStart.slice(11, 16) : ''
  return {
    text: from && at !== null && !day ? c.t('ask.moveFromTo', { title: b(task.title), from, to: b(where) }) : c.t('ask.moveTo', { title: b(task.title), to: b(where) }),
    actions: [
      { label: c.t('ask.moveIt'), primary: true, run: async () => {
        const undo = restorer([task], ['due', 'timeBlockStart', 'timeBlockEnd', 'sortOrder'])
        await applyMove(task, day, at)
        syncNow()
        return { text: c.t('ask.moved', { title: b(task.title), to: where }), tone: 'ok', actions: [undoAct(c, undo)] }
      } },
      { label: c.t('ask.cancel'), run: async () => null },
    ],
  }
}

function doneReply(c: Ctx, task: Task): Reply {
  if (task.state === 'done') return { text: c.t('ask.alreadyDone', { title: b(task.title) }), tone: 'muted' }
  return {
    text: c.t('ask.markDone', { title: b(task.title) }),
    actions: [
      { label: c.t('ask.markIt'), primary: true, run: async () => {
        const undo = restorer([task], ['state', 'completedAt'])
        await applyDone(task)
        syncNow()
        return { text: c.t('ask.marked', { title: b(task.title) }), tone: 'ok', actions: [undoAct(c, undo)] }
      } },
      { label: c.t('ask.cancel'), run: async () => null },
    ],
  }
}

function focusReply(c: Ctx, task: Task): Reply {
  return {
    text: c.t('ask.focusOn', { title: b(task.title) }),
    actions: [
      { label: c.t('ask.startFocus'), primary: true, run: async () => { await openFocus(task); return null } },
      { label: c.t('ask.cancel'), run: async () => null },
    ],
  }
}

function addReply(c: Ctx, raw: string): Reply {
  const day = parseDay(raw) ?? todayStr()
  const at = parseTime(raw)
  // the task's name without the when
  let title = raw
    .replace(/\b(day after tomorrow|tomorrow|tmrw?|today|tonight|next week)\b/gi, '')
    .replace(/\b(on\s+)?(sun|mon|tues?|wed(nes)?|thu(rs?)?|fri|sat(ur)?)(day)?\b/gi, '')
    .replace(/后天|明天|明日|今天|今晚|今日|下周|(?:周|星期|礼拜)[日天一二三四五六]/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/, '')
    .replace(/(上午|早上|早|中午|下午|傍晚|晚上|晚)?\s*\d{1,2}\s*[点點时](\s*(半|\d{1,2})\s*分?)?/, '')
  const ex = parseExtras(title.replace(/\b(\d{1,2})[:.](\d{2})\b(?!\s*(am|pm))/i, ''))
  title = ex.title.replace(/\s+(at|on|by|for)\s*$/i, '').replace(/^\s*(to|a|an)\s+/i, '').replace(/\s{2,}/g, ' ').trim()
  if (!title) return { text: c.t('ask.addWhat'), tone: 'muted' }
  const when = [dayLabel(day, c), at !== null ? hhmm(at) : ''].filter(Boolean).join(' ')
  return {
    text: c.t('ask.addQ', { title: b(title), when: b(when) }),
    actions: [
      { label: c.t('ask.addIt'), primary: true, run: async () => {
        const id = await applyAdd(title, day, at, ex.hours)
        syncNow()
        return { text: c.t('ask.added', { title: b(title), when }), tone: 'ok', actions: [undoAct(c, async () => { await patchAndQueue(db.tasks, 'task', id, { deleted: 1 }); syncNow() })] }
      } },
      { label: c.t('ask.cancel'), run: async () => null },
    ],
  }
}

function overdueReply(c: Ctx, d: Data): Reply {
  if (!d.overdue.length) return { text: c.t('ask.noOverdue'), tone: 'ok' }
  const names = d.overdue.slice(0, 4).map((x) => b(x.title)).join(', ')
  const more = d.overdue.length > 4 ? ' ' + c.t('ask.andMore', { n: d.overdue.length - 4 }) : ''
  return {
    text: c.t('ask.overdue', { n: d.overdue.length, list: names + more }),
    actions: [
      { label: c.t(d.overdue.length === 1 ? 'ask.moveOneToday' : 'ask.moveAllToday', { n: d.overdue.length }), primary: true, run: async () => {
        const undo = restorer(d.overdue, ['due', 'timeBlockStart', 'timeBlockEnd', 'sortOrder'])
        await moveTasksTo(d.overdue, d.today)
        return { text: c.t('ask.movedToday', { n: d.overdue.length }), tone: 'ok', actions: [undoAct(c, undo)] }
      } },
      { label: c.t('ask.planTomorrow'), run: async () => { window.dispatchEvent(new CustomEvent(PLAN_TOMORROW)); return null } },
    ],
  }
}

function nextReply(c: Ctx, d: Data): Reply {
  const open = d.todayTasks.filter(isOpen)
  if (!open.length) return { text: d.overdue.length ? c.t('ask.nextNoneOverdue', { n: d.overdue.length }) : c.t('ask.nextNone'), tone: 'ok' }
  const now = nowMin()
  const timed = open.filter((x) => x.timeBlockStart && (minOf(x.timeBlockEnd) || minOf(x.timeBlockStart)) > now)
    .sort((a, x) => a.timeBlockStart!.localeCompare(x.timeBlockStart!))[0]
  const top = open.find((x) => x.isMit)
  const task = timed ?? top ?? open[0]
  const text = timed ? c.t('ask.nextAt', { title: b(task.title), time: task.timeBlockStart!.slice(11, 16) })
    : task === top ? c.t('ask.nextTop', { title: b(task.title) }) : c.t('ask.next', { title: b(task.title) })
  return {
    text,
    actions: [
      { label: c.t('ask.startFocus'), primary: true, run: async () => { await openFocus(task); return null } },
      { label: c.t('ask.markIt'), run: async () => {
        const undo = restorer([task], ['state', 'completedAt'])
        await applyDone(task); syncNow()
        return { text: c.t('ask.marked', { title: b(task.title) }), tone: 'ok', actions: [undoAct(c, undo)] }
      } },
    ],
  }
}

async function progressReply(c: Ctx, d: Data): Promise<Reply> {
  const done = d.todayTasks.filter((x) => x.state === 'done').length
  const parts = [c.t('ask.progDone', { done: b(String(done)), n: d.todayTasks.length })]
  const min = await focusedTodayMin()
  if (min >= 1) parts.push(c.t('ask.progFocus', { time: b(hm(min / 60)) }))
  let best = 0, bestName = ''
  for (const h of await db.habits.where('active').equals(1).and((x) => !x.deleted).toArray()) {
    const s = await habitStreak(h.id)
    if (s > best) { best = s; bestName = h.name }
  }
  if (best > 1) parts.push(c.t('ask.progStreak', { name: b(bestName), n: best }))
  if (d.overdue.length) parts.push(c.t('ask.progOverdue', { n: d.overdue.length }))
  return { text: parts.join(' · ') }
}

type Window = 'morning' | 'afternoon' | 'evening' | 'day'
const WINDOWS: Record<Window, [number, number]> = { morning: [8 * 60, 12 * 60], afternoon: [13 * 60, 18 * 60], evening: [18 * 60, 22 * 60], day: [7 * 60, 22 * 60] }

/** Give today's open tasks without a time a slot in the free part of a
    window — top task first, then by priority — around the blocks already set. */
export function planSlots(tasks: Task[], win: Window, now = nowMin()) {
  const [w0, end] = WINDOWS[win]
  let at = Math.max(w0, Math.ceil((now + 5) / 15) * 15)
  const busy = tasks.filter((x) => isOpen(x) && x.timeBlockStart).map((x) => {
    const s = minOf(x.timeBlockStart), e = minOf(x.timeBlockEnd)
    return [s, e > s ? e : s + Math.round((x.estimatedHours ?? 0.5) * 60)] as const
  })
  const todo = tasks.filter((x) => isOpen(x) && !x.timeBlockStart)
    .sort((a, x) => Number(!!x.isMit) - Number(!!a.isMit) || a.priority - x.priority || byOrder(a, x))
  const slots: { task: Task; start: number; end: number }[] = []
  const left: Task[] = []
  for (const task of todo) {
    const len = Math.min(120, Math.max(15, Math.round(((task.estimatedHours ?? 0.5) * 60) / 15) * 15))
    let s = at
    for (let guard = 0; guard < 20; guard++) {
      const clash = busy.find(([bs, be]) => s < be && s + len > bs)
      if (!clash) break
      s = Math.ceil(clash[1] / 5) * 5
    }
    if (s + len > end) { left.push(task); continue }
    slots.push({ task, start: s, end: s + len })
    busy.push([s, s + len])
    at = s + len
  }
  return { slots, left, passed: at >= end && !slots.length && Math.max(w0, now) >= end }
}

function planReply(c: Ctx, d: Data, win: Window): Reply {
  const { slots, left, passed } = planSlots(d.todayTasks, win)
  const name = c.t(`ask.win.${win}`)
  if (passed) return { text: c.t('ask.planPassed', { win: name }), actions: [{ label: c.t('ask.planTomorrow'), primary: true, run: async () => { window.dispatchEvent(new CustomEvent(PLAN_TOMORROW)); return null } }] }
  if (!slots.length) return { text: d.todayTasks.some(isOpen) ? c.t('ask.planAllTimed') : c.t('ask.planNothing'), tone: 'muted' }
  const lines = slots.map((s) => `${hhmm(s.start)} ${b(s.task.title)}`).join('\n')
  const tail = left.length ? '\n' + c.t('ask.planLeft', { n: left.length, end: hhmm(WINDOWS[win][1]) }) : ''
  return {
    text: c.t('ask.planIntro', { win: name }) + '\n' + lines + tail,
    actions: [
      { label: c.t('ask.planApply'), primary: true, run: async () => {
        const undo = restorer(slots.map((s) => s.task), ['timeBlockStart', 'timeBlockEnd'])
        for (const s of slots) {
          await patchAndQueue(db.tasks, 'task', s.task.id, { timeBlockStart: `${d.today}T${hhmm(s.start)}`, timeBlockEnd: `${d.today}T${hhmm(s.end)}` })
        }
        syncNow()
        return { text: c.t('ask.planned', { n: slots.length }), tone: 'ok', actions: [undoAct(c, undo)] }
      } },
      { label: c.t('ask.cancel'), run: async () => null },
    ],
  }
}

function helpReply(c: Ctx, unknown?: string): Reply {
  const text = (unknown ? c.t('ask.unknown') + '\n' : '') + c.t('ask.help') + (aiEnabled() ? '' : '\n' + c.t('ask.helpAi'))
  // what was typed may simply be a task to add
  const add: Act[] = unknown && unknown.length <= 80
    ? [{ label: c.t('ask.addAsTask'), primary: true, run: async () => addReply(c, unknown) }]
    : []
  return { text, tone: 'muted', actions: add }
}

/* ------------------------------------------------------------------ */
/* the AI, for anything else                                           */

interface AiAction { type?: string; task?: string; date?: string; time?: string; title?: string }

async function aiReply(c: Ctx, q: string, d: Data): Promise<Reply> {
  const list = pool(d).slice(0, 40)
  const ref = list.map((x, i) => `t${i + 1}: "${x.title}" | due ${x.due ?? '-'} | ${x.timeBlockStart ? x.timeBlockStart.slice(11, 16) + (x.timeBlockEnd ? '-' + x.timeBlockEnd.slice(11, 16) : '') : 'no time'} | ${x.state} | priority ${x.priority <= 2 ? 'high' : x.priority === 3 ? 'medium' : 'low'}${x.isMit ? ' | top task' : ''}${x.recurrence ? ' | repeats ' + x.recurrence : ''}`).join('\n')
  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const prompt = `Now: ${dateLabel}, ${hhmm(nowMin())} (today is ${d.today}).\n`
    + `My tasks (today, overdue, tomorrow):\n${ref || '(none)'}\n`
    + `My request: "${q}"\n`
    + `Reply with a JSON object {"say": string, "actions": array}. "say": 1-3 short, friendly sentences answering me${c.lang === 'zh' ? ', in Chinese' : ''}; refer to tasks by their titles, never by t-numbers. `
    + `"actions": only changes I asked for (at most 6), each one of: `
    + `{"type":"move","task":"t3","date":"YYYY-MM-DD","time":"HH:MM"} (date and/or time; omit what stays), `
    + `{"type":"done","task":"t3"}, {"type":"add","title":"…","date":"YYYY-MM-DD","time":"HH:MM"} (time optional), {"type":"focus","task":"t3"}. `
    + `For a question, use an empty actions array.`
  const system = 'You are the command bar of a personal planner app. Return ONLY a JSON object with keys say and actions. Do not include any reasoning or preamble — the first character of your reply must be \'{\'. No markdown code fences, no extra text.'
  let j: { say?: string; actions?: AiAction[] }
  try {
    j = await askAIJson(prompt, system)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    return { text: msg === AI_FORMAT_ERROR ? c.t('ask.aiFormat') : c.t('ask.aiErr', { msg: msg || '?' }), tone: 'muted' }
  }
  const byRef = (r?: string) => (r && /^t\d+$/.test(r) ? list[+r.slice(1) - 1] : undefined)
  const ops: { line: string; run: () => Promise<void>; undo?: () => Promise<void>; focus?: Task }[] = []
  for (const a of (Array.isArray(j.actions) ? j.actions : []).slice(0, 6)) {
    const task = byRef(a.task)
    const day = a.date && /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : null
    const at = a.time && /^\d{1,2}:\d{2}$/.test(a.time) ? parseTime(a.time) : null
    if (a.type === 'move' && task && (day || at !== null)) {
      if (day && day !== task.due && (task.recurrence || task.seriesId)) continue
      const undo = restorer([task], ['due', 'timeBlockStart', 'timeBlockEnd', 'sortOrder'])
      const where = [day && day !== task.due ? dayLabel(day, c) : '', at !== null ? hhmm(at) : ''].filter(Boolean).join(' ')
      ops.push({ line: c.t('ask.opMove', { title: b(task.title), to: where }), run: () => applyMove(task, day, at), undo })
    } else if (a.type === 'done' && task && isOpen(task)) {
      ops.push({ line: c.t('ask.opDone', { title: b(task.title) }), run: () => applyDone(task), undo: restorer([task], ['state', 'completedAt']) })
    } else if (a.type === 'add' && a.title?.trim()) {
      const title = a.title.trim().slice(0, 200)
      const on = day ?? d.today
      let id = ''
      ops.push({
        line: c.t('ask.opAdd', { title: b(title), when: [dayLabel(on, c), at !== null ? hhmm(at) : ''].filter(Boolean).join(' ') }),
        run: async () => { id = await applyAdd(title, on, at) },
        undo: async () => { if (id) await patchAndQueue(db.tasks, 'task', id, { deleted: 1 }) },
      })
    } else if (a.type === 'focus' && task) {
      ops.push({ line: c.t('ask.opFocus', { title: b(task.title) }), run: async () => {}, focus: task })
    }
  }
  const say = (j.say ?? '').trim().replace(/\bt\d+\b/g, '') || (ops.length ? c.t('ask.aiPlan') : c.t('ask.aiEmpty'))
  if (!ops.length) return { text: say }
  return {
    text: say + '\n' + ops.map((o) => '• ' + o.line).join('\n'),
    actions: [
      { label: c.t('ask.doIt'), primary: true, run: async () => {
        for (const o of ops) await o.run()
        syncNow()
        const focus = ops.find((o) => o.focus)?.focus
        if (focus) await openFocus(focus)
        const undos = ops.filter((o) => o.undo)
        if (!undos.length) return null
        return { text: c.t('ask.doneAll', { n: undos.length }), tone: 'ok', actions: [undoAct(c, async () => { for (const o of [...undos].reverse()) await o.undo!(); syncNow() })] }
      } },
      { label: c.t('ask.cancel'), run: async () => null },
    ],
  }
}

/* ------------------------------------------------------------------ */

/** Understand a request and answer it — changes wait for the answer's button. */
export async function runCommand(input: string, c: Ctx): Promise<Reply> {
  // phones type curly apostrophes (and the suggestions use them)
  const q = input.trim().replace(/[’‘]/g, "'").replace(/[?？!！。.]+$/, '')
  const s = q.toLowerCase()
  if (!s) return helpReply(c)
  const d = await load()
  const one = (text: string, then: (x: Task) => Reply): Reply => {
    const found = findTasks(text, pool(d))
    if (!found.length) return { text: c.t('ask.notFound', { q: b(text.trim()) }), tone: 'muted' }
    if (found.length > 1) return pick(c, found, async (x) => then(x))
    return then(found[0])
  }

  if (/^(help|\?|commands|what can you do|帮助|你能做什么|怎么用)/.test(s)) return helpReply(c)
  if (/overdue|late|missed|behind|过期|逾期|拖欠|没做完的|欠的/.test(s) && !/^(move|add|done|mark|finish|focus)\b/.test(s)) return overdueReply(c, d)
  if (/plan (for |my )?tomorrow|tomorrow'?s plan|规划明天|安排明天|明天的计划|计划明天/.test(s)) {
    window.dispatchEvent(new CustomEvent(PLAN_TOMORROW))
    return { text: c.t('ask.openedPlan'), tone: 'ok' }
  }
  const win: Window | null = /evening|tonight|晚上|今晚|傍晚/.test(s) ? 'evening' : /afternoon|下午/.test(s) ? 'afternoon' : /morning|上午|早上/.test(s) ? 'morning' : /\b(day|today)\b|今天|一天/.test(s) ? 'day' : null
  if (/^(plan|schedule|organi[sz]e|arrange)\b|安排|规划|计划/.test(s) && win) return planReply(c, d, win)
  if (/what('?s| is)? next|next task|what now|now what|what should i do|下一个|接下来|现在做什么|该做什么/.test(s)) return nextReply(c, d)
  if (/how am i doing|progress|summary|status|how('?s| is| was) (my|the) day|进度|总结|今天怎么样|做得怎么样/.test(s)) return progressReply(c, d)

  let m = q.match(/^(?:please\s+)?(?:move|shift|reschedule|push|put|change|set)\s+(.+?)\s+(?:to|for|until|till|at)\s+(.+)$/i)
    ?? q.match(/^(?:把)?(.+?)(?:移到|改到|挪到|推到|放到|调到|改成)(.+)$/)
  if (m) {
    const day = parseDay(m[2]), at = parseTime(m[2])
    if (day === null && at === null) return { text: c.t('ask.whenUnclear'), tone: 'muted' }
    return one(m[1], (x) => moveReply(c, x, day, at))
  }
  m = q.match(/^(?:mark\s+)?(?:done|finish(?:ed)?|complete(?:d)?|tick(?:\s+off)?|check(?:\s+off)?)\s+(.+?)(?:\s+(?:as\s+)?done)?$/i)
    ?? q.match(/^(.+?)\s+(?:is\s+)?(?:done|finished)$/i)
    ?? q.match(/^(?:完成|做完了?|搞定了?)(.+)$/) ?? q.match(/^(.+?)(?:完成了|做完了|搞定了|已完成)$/)
  if (m) return one(m[1], (x) => doneReply(c, x))
  m = q.match(/^(?:focus(?:\s+on)?|start|work\s+on|begin|timer\s+for)\s+(.+)$/i) ?? q.match(/^(?:专注|开始|计时)(.+)$/)
  if (m) return one(m[1], (x) => focusReply(c, x))
  m = q.match(/^(?:add|new|create|remind\s+me\s+to|todo|to-do)\s*:?\s+(.+)$/i) ?? q.match(/^(?:添加|加个|加|新建|新增|提醒我)(.+)$/)
  if (m) return addReply(c, m[1])

  if (aiEnabled()) return aiReply(c, q, d)
  return helpReply(c, q)
}

/** Suggestions under the bar, for the time of day. */
export function suggestions(t: TFn): string[] {
  const h = new Date().getHours()
  const plan = h < 12 ? t('ask.sugPlanDay') : h < 17 ? t('ask.sugPlanAfternoon') : h < 21 ? t('ask.sugPlanEvening') : t('ask.sugPlanTomorrow')
  return [t('ask.sugNext'), plan, t('ask.sugOverdue'), t('ask.sugProgress')]
}
