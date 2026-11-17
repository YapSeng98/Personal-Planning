// The AI behind the command bar (lib/command.ts hands it anything its rules
// don't understand). It sees a compact summary of the whole planner — tasks,
// habits, goals, projects, focus time, the latest review, and the notes /
// reviews / older tasks that match the words asked — answers questions from
// it, and proposes changes: tasks (add, move, done, delete, priority, top
// task, focus), habits (tick, add), goals, notes and today's review.
//
// Nothing changes until the answer's button is pressed; every change goes
// through patchAndQueue / writeAndQueue (so it syncs field by field) and can
// be undone. The proxy takes ~8,000 characters of prompt, so the summary is
// cut to fit, most useful first.
import {
  db, addDays, uuid, uuidFrom, writeAndQueue, patchAndQueue, rollUpGoal, habitStreak, cleanEmoji,
  type Task, type Goal, type GoalType, type Review,
} from '../db/db'
import { accountId } from '../sync/api'
import { syncNow } from '../sync/engine'
import { askAIJson, AI_FORMAT_ERROR } from './ai'
import { openFocus } from './focus'
import { minutesByDay, live } from './items'
import { noteText } from './noteHtml'
import { restoreItem } from './bin'
import {
  pool, isOpen, b, hhmm, parseTime, dayLabel, restorer, undoAct, applyMove, applyDone, applyAdd,
  type Ctx, type Data, type Reply,
} from './command'

const PROMPT_MAX = 7800
const LEVELS: GoalType[] = ['vision', 'year', 'quarter', 'month', 'week']
const PRIO = { high: 1, medium: 3, low: 5 } as const
const prioName = (p: number) => (p <= 2 ? 'high' : p === 3 ? 'medium' : 'low')
const cut = (s: string | undefined, n: number) => { const t = (s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }

// the last question and answer, so "and tomorrow?" / "move it to 5pm" work
let last: { q: string; say: string; at: number } | null = null

/** Words to look things up by: longer English words, and pairs of Chinese characters. */
function keywords(q: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'what', 'when', 'where', 'which', 'how', 'did', 'does', 'about', 'from', 'that', 'this', 'have', 'has', 'show', 'tell', 'find', 'list', 'all', 'any', 'my', 'me', 'you', 'are', 'was', 'were', 'notes', 'note', 'task', 'tasks'])
  const out = q.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((w) => !stop.has(w)) ?? []
  for (const run of q.match(/[㐀-鿿]{2,}/g) ?? []) for (let i = 0; i + 2 <= run.length; i++) out.push(run.slice(i, i + 2))
  return [...new Set(out)].slice(0, 12)
}
const score = (text: string, words: string[]) => { const t = text.toLowerCase(); return words.filter((w) => t.includes(w)).length }

interface Refs { tasks: Task[]; habits: { id: string; name: string; target: number; today: number }[]; goals: Goal[]; projects: { id: string; title: string }[] }

/** The planner in a few thousand characters, plus what each t#/h#/g#/p# means. */
async function snapshot(q: string, d: Data): Promise<{ text: string; refs: Refs }> {
  const today = d.today
  const words = keywords(q)
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i))
  const [projects, habits, goals, near, reviews, notes, recent] = await Promise.all([
    db.projects.filter((x) => !x.deleted && !x.archived).toArray(),
    db.habits.where('active').equals(1).and((x) => !x.deleted).toArray(),
    db.goals.filter((x) => !x.deleted).toArray(),
    db.tasks.where('due').between(addDays(today, 2), addDays(today, 8), true, true).and((x) => !x.deleted).toArray(),
    db.reviews.filter((x) => !x.deleted).toArray(),
    words.length ? db.drawings.filter((x) => !x.deleted).toArray() : Promise.resolve([]),
    db.tasks.where('due').between(addDays(today, -13), today, true, true).and((x) => !x.deleted).toArray(),
  ])
  const projName = new Map(projects.map((p) => [p.id, p.title]))
  const projRef = new Map(projects.map((p, i) => [p.id, `p${i + 1}`]))

  // tasks: the command bar's pool, the coming week, and older ones matching the words
  const listed = new Set<string>()
  const tasks: Task[] = []
  const add = (x: Task) => { if (!listed.has(x.id) && tasks.length < 60) { listed.add(x.id); tasks.push(x) } }
  pool(d).slice(0, 30).forEach(add)
  near.sort((a, c) => (a.due ?? '').localeCompare(c.due ?? '')).filter(isOpen).slice(0, 15).forEach(add)
  if (words.length) {
    const older = await db.tasks.filter((x) => !x.deleted && score(`${x.title} ${x.notes ?? ''}`, words) > 0).limit(200).toArray()
    older.sort((a, c) => score(c.title, words) - score(a.title, words) || (c.due ?? '').localeCompare(a.due ?? '')).slice(0, 8).forEach(add)
  }
  const taskLine = (x: Task, i: number) => {
    const time = x.timeBlockStart ? x.timeBlockStart.slice(11, 16) + (x.timeBlockEnd ? '-' + x.timeBlockEnd.slice(11, 16) : '') : '-'
    const steps = live(x.checklist)
    const flags = [x.isMit ? 'top' : '', x.recurrence ? 'repeats ' + x.recurrence : '', x.projectId && projName.get(x.projectId) ? 'project ' + projName.get(x.projectId) : '',
      steps.length ? `steps ${steps.filter((s) => s.done).length}/${steps.length}` : ''].filter(Boolean).join(', ')
    return `t${i + 1} | ${cut(x.title, 70)} | ${x.due ?? '-'} | ${time} | ${x.state} | ${prioName(x.priority)}${flags ? ' | ' + flags : ''}`
  }

  // habits with today's count, streak and the last 7 days
  const habitRows = await Promise.all(habits.map(async (h) => {
    const logs = await db.habitLogs.where('[habitId+date]').between([h.id, week[0]], [h.id, today], true, true).and((l) => !l.deleted).toArray()
    const by = new Map(logs.map((l) => [l.date, l.count]))
    return { id: h.id, name: `${cleanEmoji(h.emoji, h.name)} ${h.name}`, target: h.targetPerDay, today: by.get(today) ?? 0, streak: await habitStreak(h.id), week: week.map((x) => ((by.get(x) ?? 0) >= h.targetPerDay ? '✓' : '·')).join('') }
  }))

  goals.sort((a, c) => LEVELS.indexOf(a.type) - LEVELS.indexOf(c.type))
  const goalRef = new Map(goals.map((g, i) => [g.id, `g${i + 1}`]))

  // done and focused: this week vs the week before
  const doneIn = (from: string, to: string) => recent.filter((x) => x.state === 'done' && (x.due ?? '') >= from && (x.due ?? '') <= to).length
  let focusToday = 0, focusWeek = 0
  for (const x of recent) for (const [day, m] of minutesByDay(x)) { if (day === today) focusToday += m; if (day >= week[0]) focusWeek += m }

  const daily = reviews.filter((r) => r.type === 'daily').sort((a, c) => c.periodStart.localeCompare(a.periodStart))
  const latest = daily[0]
  const noteHits = words.length
    ? notes.map((n) => ({ n, words: noteText(n.text ?? '', n.format === 'html'), s: 0 })).map((x) => ({ ...x, s: score(`${x.n.title} ${x.words}`, words) }))
      .filter((x) => x.s > 0).sort((a, c) => c.s - a.s).slice(0, 5)
    : []
  const reviewText = (r: Review) => [r.wins && 'wins: ' + r.wins, r.failures && 'missed: ' + r.failures, r.lesson && 'lesson: ' + r.lesson, r.nextPriorities && 'next: ' + r.nextPriorities].filter(Boolean).join('; ')
  const reviewHits = words.length ? reviews.filter((r) => r !== latest && score(reviewText(r), words) > 0).sort((a, c) => c.periodStart.localeCompare(a.periodStart)).slice(0, 4) : []

  const sections: string[] = [
    `TASKS (ref | title | due | time | state | priority | notes):\n${tasks.map(taskLine).join('\n') || '(none)'}`,
    `DONE: ${doneIn(week[0], today)} tasks in the last 7 days, ${doneIn(addDays(today, -13), addDays(today, -7))} the 7 days before. FOCUS: ${Math.round(focusToday)} min today, ${Math.round(focusWeek)} min in the last 7 days.`,
    `HABITS (ref | name | times/day | done today | streak days | last 7 days, oldest first):\n${habitRows.map((h, i) => `h${i + 1} | ${h.name} | ${h.target} | ${h.today} | ${h.streak} | ${h.week}`).join('\n') || '(none)'}`,
    `GOALS (ref | level | title | progress | status | target date | parent):\n${goals.slice(0, 25).map((g, i) => `g${i + 1} | ${g.type} | ${cut(g.title, 70)} | ${g.progress}% | ${g.status} | ${g.targetDate ?? '-'} | ${(g.parentId && goalRef.get(g.parentId)) || '-'}`).join('\n') || '(none)'}`,
    `PROJECTS (ref | title | open | done):\n${projects.map((p) => { const own = recent.filter((x) => x.projectId === p.id); return `${projRef.get(p.id)} | ${p.title} | ${own.filter(isOpen).length} | ${own.filter((x) => x.state === 'done').length}` }).join('\n') || '(none)'}`,
    latest ? `LATEST DAILY REVIEW (${latest.periodStart}${latest.mood ? ', mood ' + latest.mood : ''}${latest.energy ? ', energy ' + latest.energy + '/5' : ''}): ${cut(reviewText(latest), 400) || '(empty)'}` : 'LATEST DAILY REVIEW: none yet',
  ]
  if (noteHits.length) sections.push(`NOTES MATCHING THE REQUEST:\n${noteHits.map((x) => `"${cut(x.n.title || 'Untitled', 60)}": ${cut(x.words, 220)}`).join('\n')}`)
  if (reviewHits.length) sections.push(`REVIEWS MATCHING THE REQUEST:\n${reviewHits.map((r) => `${r.type} ${r.periodStart}: ${cut(reviewText(r), 220)}`).join('\n')}`)
  return {
    text: sections.join('\n\n'),
    refs: { tasks, habits: habitRows, goals, projects: projects.map((p) => ({ id: p.id, title: p.title })) },
  }
}

interface AiAction {
  type?: string; task?: string; habit?: string; parent?: string; project?: string
  date?: string; time?: string; title?: string; name?: string; emoji?: string; text?: string
  priority?: string; level?: string; target?: number; part?: string
}
interface Op { line: string; run: () => Promise<void>; undo?: () => Promise<void>; focus?: Task }

const REVIEW_PART = { wins: 'wins', lesson: 'lesson', next: 'nextPriorities' } as const

/** Ask the AI; its answer with a button for the changes it proposes. */
export async function aiAnswer(c: Ctx, q: string, d: Data): Promise<Reply> {
  const { text: snap, refs } = await snapshot(q, d)
  const now = new Date()
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const prev = last && Date.now() - last.at < 15 * 60_000 ? `Previous question: "${cut(last.q, 200)}" — you answered: "${cut(last.say, 300)}"\n` : ''
  const head = `Now: ${dateLabel}, ${hhmm(now.getHours() * 60 + now.getMinutes())} (today is ${d.today}). Reply in ${c.lang === 'zh' ? 'Chinese' : 'English'}.\n\n`
  const tail = `\n\n${prev}My request: "${cut(q, 500)}"\n\n`
    + `Reply with a JSON object {"say": string, "actions": array}.\n`
    + `"say": answer me in 1-4 short sentences using only the data above (refer to things by their names, never by refs like t3 or h2); if the data doesn't tell, say so.\n`
    + `"actions": only the changes I asked for (none for a question), at most 8, each an object with "type" and its fields:\n`
    + `add_task {title, date?, time?, priority?: high|medium|low, project?: p#} · move_task {task: t#, date?, time?} · done_task {task} · delete_task {task} · set_priority {task, priority} · top_task {task} · focus {task}\n`
    + `tick_habit {habit: h#} · add_habit {name, emoji?, target?: times a day}\n`
    + `add_goal {title, level: vision|year|quarter|month|week, parent?: g# one level up}\n`
    + `add_note {title, text} · add_to_review {part: wins|lesson|next, text} (today's daily review)\n`
    + `Dates YYYY-MM-DD, times HH:MM (24h).`
  const room = PROMPT_MAX - head.length - tail.length
  const prompt = head + (snap.length > room ? snap.slice(0, room - 1) + '…' : snap) + tail
  const system = 'You are the assistant inside a personal planner app: you answer questions about the user\'s own planner data shown to you and propose changes they ask for. Return ONLY a JSON object with keys say and actions. The first character of your reply must be \'{\'. No markdown code fences, no reasoning, no extra text.'
  let j: { say?: string; actions?: AiAction[] }
  try {
    j = await askAIJson(prompt, system)
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    return { text: msg === AI_FORMAT_ERROR ? c.t('ask.aiFormat') : c.t('ask.aiErr', { msg: msg || '?' }), tone: 'muted' }
  }

  const ref = <T,>(list: T[], r: string | undefined, p: string): T | undefined => (r && new RegExp(`^${p}\\d+$`).test(r) ? list[+r.slice(1) - 1] : undefined)
  const dateOk = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null)
  const ops: Op[] = []
  for (const a of (Array.isArray(j.actions) ? j.actions : []).slice(0, 8)) {
    const task = ref(refs.tasks, a.task, 't')
    const day = dateOk(a.date)
    const at = a.time && /^\d{1,2}:\d{2}$/.test(a.time) ? parseTime(a.time) : null
    const prio = a.priority && a.priority in PRIO ? PRIO[a.priority as keyof typeof PRIO] : null
    switch (a.type) {
      case 'move_task':
        if (!task || (!day && at === null) || (day && day !== task.due && (task.recurrence || task.seriesId))) break
        ops.push({ line: c.t('ask.opMove', { title: b(task.title), to: [day && day !== task.due ? dayLabel(day, c) : '', at !== null ? hhmm(at) : ''].filter(Boolean).join(' ') }),
          run: () => applyMove(task, day, at), undo: restorer([task], ['due', 'timeBlockStart', 'timeBlockEnd', 'sortOrder']) })
        break
      case 'done_task':
        if (task && isOpen(task)) ops.push({ line: c.t('ask.opDone', { title: b(task.title) }), run: () => applyDone(task), undo: restorer([task], ['state', 'completedAt']) })
        break
      case 'delete_task':
        // a repeating task asks "only this day / all after" — that's the task's own sheet
        if (task && !task.seriesId) ops.push({ line: c.t('ask.opDelete', { title: b(task.title) }),
          run: async () => { await patchAndQueue(db.tasks, 'task', task.id, { deleted: 1 }); if (task.goalId) await rollUpGoal(task.goalId) },
          undo: () => restoreItem({ kind: 'task', id: task.id }) })
        break
      case 'set_priority':
        if (task && prio !== null && prio !== task.priority) ops.push({ line: c.t('ask.opPriority', { title: b(task.title), p: c.t(`ask.prio.${a.priority}`) }),
          run: async () => { await patchAndQueue(db.tasks, 'task', task.id, { priority: prio }) }, undo: restorer([task], ['priority']) })
        break
      case 'top_task': {
        if (!task || task.isMit || !task.due) break
        let undo: () => Promise<void> = async () => {}
        ops.push({ line: c.t('ask.opTop', { title: b(task.title), day: dayLabel(task.due, c) }),
          // one top task a day: the others lose the star
          run: async () => {
            const sameDay = await db.tasks.where('due').equals(task.due!).and((x) => !x.deleted && (!!x.isMit || x.id === task.id)).toArray()
            undo = restorer(sameDay, ['isMit'])
            for (const x of sameDay) await patchAndQueue(db.tasks, 'task', x.id, { isMit: x.id === task.id })
          },
          undo: () => undo() })
        break
      }
      case 'focus':
        if (task && isOpen(task)) ops.push({ line: c.t('ask.opFocus', { title: b(task.title) }), run: async () => {}, focus: task })
        break
      case 'add_task': {
        const title = cut(a.title, 200)
        if (!title) break
        const on = day ?? d.today
        const project = ref(refs.projects, a.project, 'p')
        let id = ''
        ops.push({ line: c.t('ask.opAdd', { title: b(title), when: [dayLabel(on, c), at !== null ? hhmm(at) : '', prio !== null && prio !== 3 ? c.t(`ask.prio.${a.priority}`) : '', project?.title ?? ''].filter(Boolean).join(' · ') }),
          run: async () => {
            id = await applyAdd(title, on, at)
            if ((prio !== null && prio !== 3) || project) await patchAndQueue(db.tasks, 'task', id, { ...(prio !== null ? { priority: prio } : {}), ...(project ? { projectId: project.id } : {}) })
          },
          undo: async () => { if (id) await patchAndQueue(db.tasks, 'task', id, { deleted: 1 }) } })
        break
      }
      case 'tick_habit': {
        const h = ref(refs.habits, a.habit, 'h')
        if (!h || h.today >= h.target) break
        let undo: () => Promise<void> = async () => {}
        ops.push({ line: c.t('ask.opTick', { name: b(h.name), n: h.today + 1, of: h.target }),
          run: async () => {
            const existing = await db.habitLogs.where('[habitId+date]').equals([h.id, d.today]).first()
            if (existing && !existing.deleted) {
              const before = existing.count
              await patchAndQueue(db.habitLogs, 'habit_log', existing.id, { count: Math.min(h.target, before + 1) })
              undo = async () => { await patchAndQueue(db.habitLogs, 'habit_log', existing.id, { count: before }) }
            } else {
              // the same id Today uses for a habit's day, so two devices make one record
              const id = await uuidFrom(`log:${h.id}:${d.today}`)
              await writeAndQueue(db.habitLogs, 'habit_log', { id, habitId: h.id, date: d.today, count: 1, deleted: 0, updatedAt: Date.now() })
              undo = async () => { await patchAndQueue(db.habitLogs, 'habit_log', id, { count: 0 }) }
            }
          },
          undo: () => undo() })
        break
      }
      case 'add_habit': {
        const name = cut(a.name ?? a.title, 60)
        if (!name) break
        const id = uuid()
        const target = Math.max(1, Math.min(20, Math.round(Number(a.target) || 1)))
        ops.push({ line: c.t('ask.opAddHabit', { name: b(name), n: target }),
          run: () => writeAndQueue(db.habits, 'habit', { id, name, emoji: cleanEmoji(a.emoji ?? '', name) || '✅', frequency: 'daily', targetPerDay: target, active: 1, deleted: 0, updatedAt: Date.now() }),
          undo: async () => { await patchAndQueue(db.habits, 'habit', id, { deleted: 1, active: 0 }) } })
        break
      }
      case 'add_goal': {
        const title = cut(a.title, 150)
        const level = LEVELS.includes(a.level as GoalType) ? (a.level as GoalType) : null
        if (!title || !level) break
        // a goal's parent is the level directly above (a month goal under a quarter goal)
        const parent = ref(refs.goals, a.parent, 'g')
        const parentId = parent && LEVELS.indexOf(parent.type) === LEVELS.indexOf(level) - 1 ? parent.id : undefined
        const id = uuid()
        ops.push({ line: c.t('ask.opAddGoal', { title: b(title), level: c.t(`gtype.${level}`).toLowerCase() }) + (parentId ? ' ↑ ' + b(parent!.title) : ''),
          run: async () => { await writeAndQueue(db.goals, 'goal', { id, title, type: level, parentId, status: 'not_started', progress: 0, deleted: 0, updatedAt: Date.now() }); if (parentId) await rollUpGoal(parentId) },
          undo: async () => { await patchAndQueue(db.goals, 'goal', id, { deleted: 1 }); if (parentId) await rollUpGoal(parentId) } })
        break
      }
      case 'add_note': {
        const title = cut(a.title, 120)
        const body = (a.text ?? '').trim().slice(0, 4000)
        if (!title && !body) break
        const id = uuid()
        const html = body.split('\n').map((l) => `<p>${l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '<br>'}</p>`).join('')
        ops.push({ line: c.t('ask.opAddNote', { title: b(title || cut(body, 40)) }),
          run: () => writeAndQueue(db.drawings, 'drawing', { id, title, kind: 'text', text: html, format: 'html', deleted: 0, updatedAt: Date.now() }),
          undo: async () => { await patchAndQueue(db.drawings, 'drawing', id, { deleted: 1 }) } })
        break
      }
      case 'add_to_review': {
        const field = a.part && a.part in REVIEW_PART ? REVIEW_PART[a.part as keyof typeof REVIEW_PART] : null
        const add = (a.text ?? '').trim().slice(0, 1000)
        if (!field || !add) break
        let undo: () => Promise<void> = async () => {}
        ops.push({ line: c.t('ask.opReview', { part: c.t(`ask.part.${a.part}`), text: cut(add, 80) }),
          run: async () => {
            const cur = await db.reviews.filter((r) => !r.deleted && r.type === 'daily' && r.periodStart === d.today).first()
            if (cur) {
              const before = cur[field]
              await patchAndQueue(db.reviews, 'review', cur.id, { [field]: before ? `${before}\n${add}` : add } as Partial<Review>)
              undo = async () => { await patchAndQueue(db.reviews, 'review', cur.id, { [field]: before } as Partial<Review>) }
            } else {
              // the id Reviews gives a day's review, so it's the same record there
              const owner = accountId()
              const id = owner ? await uuidFrom(`review:${owner}:daily:${d.today}`) : uuid()
              await writeAndQueue(db.reviews, 'review', { id, type: 'daily', periodStart: d.today, periodEnd: d.today, [field]: add, deleted: 0, updatedAt: Date.now() } as Review)
              undo = async () => { await patchAndQueue(db.reviews, 'review', id, { deleted: 1 }) }
            }
          },
          undo: () => undo() })
        break
      }
    }
  }

  const say = (j.say ?? '').trim().replace(/\b[tghp]\d+\b/g, '').replace(/\s{2,}/g, ' ') || (ops.length ? c.t('ask.aiPlan') : c.t('ask.aiEmpty'))
  last = { q, say, at: Date.now() }
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

