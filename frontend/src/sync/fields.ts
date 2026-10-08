// Which fields of each record type sync, and how a write's changes are
// described for the server's field-level merge (supabase/schema.sql →
// sync_push). Kept in its own module so the data layer (db.ts) and the sync
// engine can both use it without importing each other.

export type SyncTable = 'task' | 'habit' | 'habit_log' | 'goal' | 'review' | 'project' | 'drawing' | 'folder'

// Every syncable field per table — MUST match the field lists in
// supabase/schema.sql's sync_push (generated) and sync_pull. The push always
// carries all of them, '' for anything unset — that's what makes CLEARING a
// field (time block, notes, a goal link…) propagate.
export const SYNC_FIELDS: Record<SyncTable, string[]> = {
  task: ['title', 'notes', 'state', 'priority', 'due', 'timeBlockStart', 'timeBlockEnd',
    'estimatedHours', 'actualHours', 'goalId', 'projectId', 'isMit', 'sortOrder',
    'reminderDaysBefore', 'recurrence', 'seriesId', 'deleted'],
  habit: ['name', 'emoji', 'frequency', 'targetPerDay', 'active', 'deleted'],
  habit_log: ['habitId', 'date', 'count', 'deleted'],
  goal: ['title', 'type', 'parentId', 'lifeArea', 'whyItMatters', 'progress', 'status', 'targetDate', 'deleted'],
  review: ['type', 'periodStart', 'periodEnd', 'wins', 'failures', 'lesson', 'mood', 'energy', 'nextPriorities', 'attachments', 'deleted'],
  project: ['title', 'color', 'archived', 'deleted'],
  drawing: ['title', 'kind', 'dataUrl', 'text', 'format', 'attachments', 'folderId', 'pinned', 'deleted'],
  folder: ['name', 'parentId', 'cover', 'coverY', 'coverH', 'deleted'],
}

// Fields added since the server started listing the fields its schema has
// (sync_pull's `fields`). The app updates itself but schema.sql is run by
// hand, so a device can be ahead of the server: a change to a field the
// server doesn't have yet is held back (kept queued on the device) instead
// of being sent to a server that would drop it — see serverHas in
// sync/engine.ts. A server that sends no list has none of these. A new
// field goes in SYNC_FIELDS *and* here (and in gen_sync_push.py's LATER).
export const LATER_FIELDS: Partial<Record<SyncTable, string[]>> = {
  drawing: ['pinned'],
}

type Att = { id: string }

/** Comparable form of a field value: unset/''/false all mean "not set". */
export function norm(v: unknown): string {
  if (v == null || v === '' || v === false) return ''
  if (v === true) return '1'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export interface RecordDiff {
  /** Synced fields that differ. */
  fields: string[]
  /** Attachment ids added or replaced, and removed. */
  attUp: string[]
  attRm: string[]
}

/** What changed between two versions of a record, in sync terms. */
export function diffRecord(table: SyncTable, before: object, after: object): RecordDiff {
  const a = before as Record<string, unknown>, b = after as Record<string, unknown>
  const fields: string[] = []
  const attUp: string[] = [], attRm: string[] = []
  for (const f of SYNC_FIELDS[table]) {
    if (f === 'attachments') {
      const prev = new Map(((a[f] as Att[] | undefined) ?? []).map((x) => [x.id, JSON.stringify(x)]))
      const next = (b[f] as Att[] | undefined) ?? []
      for (const x of next) if (prev.get(x.id) !== JSON.stringify(x)) attUp.push(x.id)
      const nextIds = new Set(next.map((x) => x.id))
      for (const id of prev.keys()) if (!nextIds.has(id)) attRm.push(id)
      if (attUp.length || attRm.length) fields.push(f)
    } else if (norm(a[f]) !== norm(b[f])) {
      fields.push(f)
    }
  }
  return { fields, attUp, attRm }
}

/** Apply attachment changes to a list by id: removals dropped, updates
    replaced in place, additions appended. Mirrors merge_attachments() in
    schema.sql, so a device's view matches what the server will hold. */
export function applyAttachmentOps<T extends Att>(list: T[], up: T[], rm: string[]): T[] {
  const upMap = new Map(up.map((x) => [x.id, x]))
  const rmSet = new Set(rm.filter((id) => !upMap.has(id)))
  const out = list.filter((x) => !rmSet.has(x.id)).map((x) => upMap.get(x.id) ?? x)
  for (const x of up) if (!list.some((y) => y.id === x.id)) out.push(x)
  return out
}

/** The part of `after` that differs from `before`, over `keys` — what a form
    actually changed, as a patch for patchAndQueue. Fields the user didn't
    touch are left out, so saving can't write a stale value over a change
    another device made while the form was open. */
export function patchFrom<T extends object>(before: T, after: Partial<T>, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {}
  for (const k of keys) {
    const a = (before as Record<string, unknown>)[k as string], b = (after as Record<string, unknown>)[k as string]
    if (norm(a) !== norm(b)) (out as Record<string, unknown>)[k as string] = b
  }
  return out
}

/** Fields a NEW record claims: the ones that have a value (plus `deleted`,
    so creating a record can revive one deleted elsewhere — unless it's
    `derived`, e.g. a generated repeat, which must never undo a delete).
    If the same record already exists on the server (ids derived from
    content — a habit's day, a review's period, a repeat's date), only these
    are applied, so a new copy never blanks out what another device wrote. */
export function filledFields(table: SyncTable, record: object, derived = false): string[] {
  const r = record as Record<string, unknown>
  return SYNC_FIELDS[table].filter((f) =>
    f === 'deleted' ? !derived
      : f === 'attachments' ? ((r[f] as unknown[] | undefined)?.length ?? 0) > 0
        : norm(r[f]) !== '')
}
