import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { db, uuid, todayStr, writeAndQueue, patchAndQueue, editTaskList, stopRepeatingFrom, endSeries, rollUpGoal, nextCompletedAt, type Task, type Goal, type Project, type TaskState, type GoalType } from '../db/db'
import { patchFrom } from '../sync/fields'
import { syncNow } from '../sync/engine'
import Select from './Select'
import AutoTextarea from './AutoTextarea'
import Checklist from './Checklist'
import { useLang } from '../lib/i18n'
import { hm } from '../lib/timer'
import { live, spentHours, clearFocus, type CheckItem } from '../lib/items'
import { parseExtras, fromDailyBrief, DAILY_BRIEF_URL } from '../lib/tasks'
import { aiEnabled, askAIJson, AI_FORMAT_ERROR } from '../lib/ai'

// One form for BOTH adding and editing a task, so the two can never diverge.
// task=null → create mode; task=existing → edit mode (adds Delete).

const STATES: TaskState[] = ['open', 'in_progress', 'done', 'cancelled']

/** Whole days from `from` to `to` (both YYYY-MM-DD), can be negative. */
function daysBetween(from: string, to: string): number {
  return Math.round((new Date(to + 'T00:00').getTime() - new Date(from + 'T00:00').getTime()) / 86400_000)
}

const REMINDER_MAX_DAYS = 3
const REMINDER_LABELS = ['task.reminderOnDueDay', 'task.reminder1Day', 'task.reminder2Days', 'task.reminder3Days']
/** Fields this form edits — only those that differ from the task as opened are saved. */
const EDITABLE: (keyof Task)[] = ['title', 'notes', 'state', 'priority', 'due', 'timeBlockStart', 'timeBlockEnd', 'estimatedHours',
  'actualHours', 'completedAt', 'goalId', 'projectId', 'isMit', 'reminderDaysBefore', 'recurrence', 'seriesId']

/** Priority 1 critical … 5 optional; the form offers three levels (the
    card's colour follows: 1–2 high, 3 medium, 4–5 low). */
const PRIORITIES = [{ value: 1, key: 'task.prioHigh' }, { value: 3, key: 'task.prioMed' }, { value: 5, key: 'task.prioLow' }] as const
const prioLevel = (p: number) => (p <= 2 ? 1 : p === 3 ? 3 : 5)

/** Estimate choices, in hours. */
const ESTIMATES = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]

/** The Monday after `from` (YYYY-MM-DD). */
function nextMonday(from: string): string {
  const d = new Date(from + 'T00:00')
  d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7))
  return todayStr(d)
}

const GOAL_LEVELS: GoalType[] = ['vision', 'year', 'quarter', 'month', 'week']

export default function TaskForm({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const editing = task !== null
  const [title, setTitle] = useState(task?.title ?? '')
  const titleRef = useRef<HTMLTextAreaElement>(null)
  // Titles can run long (quick-add notes, pasted text) — grow the field to
  // fit instead of clipping the end of the line off-screen.
  useLayoutEffect(() => {
    const el = titleRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [title])
  const [due, setDue] = useState(task?.due ?? todayStr())
  const [start, setStart] = useState(task?.timeBlockStart?.slice(11, 16) ?? '')
  const [end, setEnd] = useState(task?.timeBlockEnd?.slice(11, 16) ?? '')
  const [goalId, setGoalId] = useState(task?.goalId ?? '')
  const [projectId, setProjectId] = useState(task?.projectId ?? '')
  const [state, setState] = useState<TaskState>(task?.state ?? 'open')
  const [isMit, setIsMit] = useState(Boolean(task?.isMit))
  const [reminderDays, setReminderDays] = useState<number | undefined>(task?.reminderDaysBefore ?? undefined)
  const [recurrence, setRecurrence] = useState<Task['recurrence']>(task?.recurrence)
  const [hours, setHours] = useState<number | undefined>(task?.estimatedHours)
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [priority, setPriority] = useState(task?.priority ?? 3)
  const spent = task ? spentHours(task) : 0
  const [resetSpent, setResetSpent] = useState(false)
  // a new task's steps (an existing task's save as they're edited)
  const [steps, setSteps] = useState<CheckItem[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [aiParsing, setAiParsing] = useState(false)
  const [aiParseErr, setAiParseErr] = useState('')
  const { t, lang } = useLang()

  // A reminder N days before due never fires if that day has already
  // passed — cap how far back it can be set to what's actually left between
  // today and the due date (0 = due date is today or already past).
  const maxReminderDays = Math.max(0, Math.min(REMINDER_MAX_DAYS, daysBetween(todayStr(), due)))
  const reminderOptions = [
    { value: '', label: t('task.reminderOff') },
    ...REMINDER_LABELS.slice(0, maxReminderDays + 1).map((label, days) => ({ value: String(days), label: t(label) })),
  ]

  useEffect(() => {
    setReminderDays((d) => (d != null ? Math.min(d, maxReminderDays) : undefined))
  }, [maxReminderDays])

  useEffect(() => {
    // Any level can take tasks, completed goals included: a goal whose only
    // task is done hits 100% and completes, and hiding it would stop any
    // other task from linking to it. Linking a new open task just pulls it
    // back to in progress.
    db.goals
      .filter((g) => !g.deleted)
      .toArray()
      .then((gs) => setGoals(gs.sort((a, b) => GOAL_LEVELS.indexOf(a.type) - GOAL_LEVELS.indexOf(b.type) || a.title.localeCompare(b.title))))
    db.projects.filter((p) => !p.deleted && !p.archived).toArray().then(setProjects)
  }, [])

  // While creating, typing natural language fills the structured fields live.
  function onTitle(v: string) {
    setAiParseErr('')
    if (editing) {
      setTitle(v)
      return
    }
    let working = v
    if (/\btomorrow\b/i.test(working)) {
      setDue(todayStr(new Date(Date.now() + 86400_000)))
      working = working.replace(/\btomorrow\b/gi, '').trim()
    } else if (/\btoday\b/i.test(working)) {
      setDue(todayStr())
      working = working.replace(/\btoday\b/gi, '').trim()
    }
    const { title: cleaned, time, hours: h } = parseExtras(working)
    if (time) setStart(time)
    if (h !== undefined) setHours(h)
    setTitle(time || h !== undefined ? cleaned : working)
  }

  /** The instant regex parse above only catches simple patterns (a time, an
      "Nh" duration, today/tomorrow). This goes further for messier text —
      relative dates ("next Friday"), and matching a mentioned project by
      name — at the cost of a round trip, so it's opt-in via a button rather
      than running on every keystroke. */
  async function parseWithAI() {
    if (!title.trim() || aiParsing) return
    setAiParsing(true)
    setAiParseErr('')
    try {
      const dateLabel = new Date().toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      const projectList = projects.map((p) => p.title).join(', ') || '(none)'
      const prompt = `Today is ${dateLabel} (${todayStr()}).\n`
        + `Quick-add task text: "${title.trim()}"\n`
        + `Existing projects: ${projectList}\n`
        + `Extract: a clean task title with any date/time/project mentions removed, `
        + `the due date (YYYY-MM-DD, resolving relative terms like "tomorrow" or "next Friday" against today; empty string if none mentioned), `
        + `a start time in 24h HH:MM if one is mentioned (empty string if none), `
        + `an estimated duration in hours as a number if one is mentioned (0 if none), `
        + `and, only if the text clearly refers to one of the existing projects, that project's name copied EXACTLY as listed (empty string otherwise).`
      const system = lang === 'zh'
        ? '你帮助把快速添加的任务文本解析成结构化字段。只返回一个 JSON 对象，键为 title、due、start、hours、project。不要输出任何思考过程或前言 — 第一个字符必须是 {，不要 markdown 代码块，不要多余文字。'
        : "You parse quick-add task text into structured fields. Return ONLY a JSON object with keys title, due, start, hours, project. Do not include any reasoning, thinking, or preamble — the first character of your reply must be '{'. No markdown code fences, no extra text."
      const j = await askAIJson<{ title?: string; due?: string; start?: string; hours?: number; project?: string }>(prompt, system)
      if (j.title) setTitle(j.title)
      if (j.due) setDue(j.due)
      if (j.start) setStart(j.start)
      if (typeof j.hours === 'number' && j.hours > 0) setHours(j.hours)
      if (j.project) {
        const match = projects.find((p) => p.title.toLowerCase() === j.project!.toLowerCase())
        if (match) setProjectId(match.id)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : ''
      setAiParseErr(msg === AI_FORMAT_ERROR ? t('task.aiParseErrFormat') : (msg || t('task.aiParseErr')))
    } finally {
      setAiParsing(false)
    }
  }

  async function save() {
    if (!title.trim() || submitting) return
    setSubmitting(true)

    try {
      // Turning off repeat on an occurrence that hasn't happened yet removes
      // it outright — there's no history to preserve, and it was the latest
      // row in its series, so nothing more gets generated. An already-done
      // occurrence just loses the badge and stays as a normal record.
      // Turning repeat off ends the whole series: earlier occurrences still
      // carry `recurrence`, and the newest of them would otherwise restart
      // the series the next day. They keep their history, minus the badge.
      // (every day of the series loses the repeat — deleted days too — and
      // this one goes unless it's done: see endSeries)
      if (task && task.recurrence && !recurrence && task.seriesId) {
        await endSeries(task.seriesId, task.due ?? todayStr())
        if (task.state !== 'done') {
          if (task.goalId) await rollUpGoal(task.goalId)
          syncNow()
          onClose()
          return
        }
      }

      const id = task?.id ?? uuid()
      const record: Task = {
        id,
        sysId: task?.sysId,
        title: title.trim(),
        notes: notes.trim() ? notes : undefined,
        state,
        // an unchanged level keeps an in-between value (2, 4) as it was
        priority: task && prioLevel(task.priority) === priority ? task.priority : priority,
        due,
        timeBlockStart: start ? `${due}T${start}` : undefined,
        timeBlockEnd: end ? `${due}T${end}` : undefined,
        estimatedHours: hours,
        actualHours: resetSpent ? undefined : task?.actualHours,
        checklist: task ? task.checklist : (live(steps).length ? steps : undefined),
        completedAt: nextCompletedAt(task?.state ?? 'open', task?.completedAt, state),
        goalId: goalId || undefined,
        projectId: projectId || undefined,
        isMit,
        reminderDaysBefore: reminderDays,
        recurrence,
        seriesId: recurrence ? (task?.seriesId ?? id) : task?.seriesId,
        deleted: 0,
        updatedAt: Date.now(),
      }
      // Editing: save only what changed in this form, on top of the task as
      // stored now — fields edited on another device meanwhile are kept.
      const saved = task
        ? await patchAndQueue(db.tasks, 'task', id, patchFrom(task, record, EDITABLE))
        : (await writeAndQueue(db.tasks, 'task', record), record)
      // "Reset" the time: its sessions go too, or Stats would still count them
      if (task && resetSpent) await editTaskList(id, 'focusLog', (log) => clearFocus(log))
      const goalNow = saved?.goalId
      if (task?.goalId && task.goalId !== goalNow) await rollUpGoal(task.goalId)
      if (goalNow) await rollUpGoal(goalNow)
      syncNow()
      onClose()
    } finally {
      // Only matters if save() threw before reaching onClose() (which
      // unmounts this form) — otherwise this runs on a component that's
      // already gone, which is harmless.
      setSubmitting(false)
    }
  }

  // a repeating task asks: only this day, or this and every day after?
  const [askRepeat, setAskRepeat] = useState(false)
  const repeating = !!task?.seriesId && !!task.recurrence

  async function remove() {
    if (!task) return
    if (repeating) {
      setAskRepeat(true)
      return
    }
    if (!window.confirm(t('task.deleteConfirm', { title: task.title }))) return
    await patchAndQueue(db.tasks, 'task', task.id, { deleted: 1 })
    if (task.goalId) await rollUpGoal(task.goalId)
    syncNow()
    onClose()
  }

  async function removeRepeating(all: boolean) {
    if (!task) return
    if (all) await stopRepeatingFrom(task)
    else await patchAndQueue(db.tasks, 'task', task.id, { deleted: 1 })
    if (task.goalId) await rollUpGoal(task.goalId)
    syncNow()
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <textarea
            ref={titleRef}
            className="task-title-field"
            rows={1}
            autoFocus
            placeholder={editing ? '' : t('task.titlePh')}
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
            aria-label="Task title"
          />
          {!editing && aiEnabled() && (
            <>
              <button type="button" className="btn ai-draft-btn" onClick={parseWithAI} disabled={!title.trim() || aiParsing}>
                {aiParsing ? t('task.aiParsing') : t('task.aiParse')}
              </button>
              {aiParseErr && <div className="ai-status err">{aiParseErr}</div>}
            </>
          )}
          <div className="form-grid">
            <div className="f">
              <label className="fl">{t('task.due')}</label>
              <div className={`date-wrap ${due ? '' : 'no-val'}`} data-ph={t('task.tapToSet')}>
                <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
              <div className="quick-dates" role="group" aria-label={t('task.due')}>
                {([['task.today', todayStr()], ['task.tomorrow', todayStr(new Date(Date.now() + 86400_000))], ['task.nextWeek', nextMonday(todayStr())]] as const).map(([key, d]) => (
                  <button key={key} type="button" className={`qd ${due === d ? 'on' : ''}`} aria-pressed={due === d} onClick={() => setDue(d)}>{t(key)}</button>
                ))}
              </div>
            </div>
            <div className="f-pair prio-pair">
              <div className="f">
                <label className="fl">{t('task.priority')}</label>
                <div className="prio-seg" role="radiogroup" aria-label={t('task.priority')}>
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      role="radio"
                      aria-checked={prioLevel(priority) === p.value}
                      className={`prio p${p.value} ${prioLevel(priority) === p.value ? 'on' : ''}`}
                      onClick={() => setPriority(p.value)}
                    >{t(p.key)}</button>
                  ))}
                </div>
              </div>
              <div className="f">
                <label className="fl">{t('task.estimate')}</label>
                <Select
                  ariaLabel={t('task.estimate')}
                  value={hours ? String(hours) : ''}
                  onChange={(v) => setHours(v ? Number(v) : undefined)}
                  options={[
                    { value: '', label: t('task.noEstimate') },
                    ...[...new Set([...ESTIMATES, ...(hours && !ESTIMATES.includes(hours) ? [hours] : [])])].sort((a, b) => a - b).map((h) => ({ value: String(h), label: hm(h) })),
                  ]}
                />
              </div>
            </div>
            <Checklist taskId={task?.id} value={steps} onChange={setSteps} />
            <div className="f">
              <label className="fl">{t('task.timeBlock')}</label>
              <div className="time-row">
                <div className={`date-wrap ${start ? '' : 'no-val'}`} data-ph={t('task.start')}>
                  <input type="time" value={start} onChange={(e) => setStart(e.target.value)} aria-label={t('task.start')} />
                </div>
                <span>–</span>
                <div className={`date-wrap ${end ? '' : 'no-val'}`} data-ph={t('task.end')}>
                  <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} aria-label={t('task.end')} />
                </div>
              </div>
              {(start || end) && (
                <button type="button" className="clear-link" onClick={() => { setStart(''); setEnd('') }}>
                  {t('task.clearTime')}
                </button>
              )}
            </div>
            {goals.length > 0 && (
              <div className="f">
                <label className="fl">{t('task.goal')}</label>
                <Select
                  ariaLabel={t('task.goal')}
                  value={goalId}
                  onChange={setGoalId}
                  options={[{ value: '', label: t('task.noGoal') }, ...goals.map((g) => ({ value: g.id, label: `🎯 ${g.title} · ${t(`gtype.${g.type}`)}${g.status === 'completed' ? ' ✓' : ''}` }))]}
                />
              </div>
            )}
            {projects.length > 0 && (
              <div className="f">
                <label className="fl">{t('task.project')}</label>
                <Select
                  ariaLabel={t('task.project')}
                  value={projectId}
                  onChange={setProjectId}
                  options={[{ value: '', label: t('task.noProject') }, ...projects.map((p) => ({ value: p.id, label: `🗂️ ${p.title}` }))]}
                />
              </div>
            )}
            {editing && (
              <div className="f">
                <label className="fl">{t('task.status')}</label>
                <Select
                  ariaLabel={t('task.status')}
                  value={state}
                  onChange={(v) => setState(v as TaskState)}
                  options={STATES.map((s) => ({ value: s, label: t('taskstate.' + s) }))}
                />
              </div>
            )}
            <div className="f">
              <label className="fl">{t('task.reminder')}</label>
              <Select
                ariaLabel={t('task.reminder')}
                value={reminderDays == null ? '' : String(reminderDays)}
                onChange={(v) => setReminderDays(v === '' ? undefined : Number(v))}
                options={reminderOptions}
              />
            </div>
            <div className="f">
              <label className="fl">{t('task.repeat')}</label>
              <Select
                ariaLabel={t('task.repeat')}
                value={recurrence ?? ''}
                onChange={(v) => setRecurrence(v === '' ? undefined : (v as Task['recurrence']))}
                options={[
                  { value: '', label: t('task.repeatOff') },
                  { value: 'daily', label: t('task.repeatDaily') },
                  { value: 'weekly', label: t('task.repeatWeekly') },
                  { value: 'monthly', label: t('task.repeatMonthly') },
                ]}
              />
              {task && task.recurrence && !recurrence && task.state !== 'done' && (
                <p className="hint">{t('task.repeatOffHint')}</p>
              )}
            </div>
            <button
              type="button"
              className={`chip-toggle ${isMit ? 'on' : ''}`}
              onClick={() => setIsMit(!isMit)}
              aria-pressed={isMit}
            >
              ⭐ {t('task.mitFull')} {isMit ? t('task.on') : ''}
            </button>
            <div className="f">
              <label className="fl">{t('task.notes')}</label>
              <AutoTextarea
                className="task-notes"
                rows={2}
                value={notes}
                placeholder={t('task.notesPh')}
                onChange={(e) => setNotes(e.target.value)}
                aria-label={t('task.notes')}
              />
              {task && fromDailyBrief(task) && (
                <a className="brief-link" href={DAILY_BRIEF_URL} target="_blank" rel="noopener noreferrer">
                  📋 {t('brief.open')} ↗
                </a>
              )}
            </div>
            {editing && spent > 0 && !resetSpent && (
              <div className="f spent-row">
                <span>⏱ {t('task.spent', { time: hm(spent) })}{hours ? ` · ${t('task.ofEstimate', { time: hm(hours) })}` : ''}</span>
                <button type="button" className="clear-link" onClick={() => setResetSpent(true)}>{t('task.resetSpent')}</button>
              </div>
            )}
          </div>
        </div>
        {askRepeat ? (
          <div className="sheet-actions del-repeat" role="alertdialog" aria-label={t('task.deleteRepeatQ')}>
            <p>{t('task.deleteRepeatQ')}</p>
            <div className="del-repeat-btns">
              <button className="btn" onClick={() => setAskRepeat(false)}>{t('common.cancel')}</button>
              <button className="btn btn-danger" onClick={() => removeRepeating(false)}>{t('task.deleteOne')}</button>
              <button className="btn btn-danger-solid" onClick={() => removeRepeating(true)}>{t('task.deleteAllAfter')}</button>
            </div>
          </div>
        ) : (
        <div className="row sheet-actions" style={{ justifyContent: editing ? 'space-between' : 'flex-end' }}>
          {editing && <button className="btn btn-danger" onClick={remove} disabled={submitting}>{t('common.delete')}</button>}
          <span style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="btn" onClick={onClose} disabled={submitting}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={submitting}>
              {editing ? t('task.save') : t('task.addTask')}
            </button>
          </span>
        </div>
        )}
      </div>
    </div>
  )
}
