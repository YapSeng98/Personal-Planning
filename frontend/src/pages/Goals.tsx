import { useEffect, useState, useCallback } from 'react'
import { db, uuid, writeAndQueue, rollUpGoal, CHANGED, type Goal, type GoalType } from '../db/db'
import { syncNow } from '../sync/engine'
import Select from '../components/Select'
import { useLang } from '../lib/i18n'

const ORDER: GoalType[] = ['vision', 'year', 'quarter', 'month', 'week']
const STATUSES = ['not_started', 'in_progress', 'at_risk', 'completed', 'abandoned'] as const

const blank = {
  title: '',
  type: 'year' as GoalType,
  parentId: '',
  targetDate: '',
  status: 'not_started' as Goal['status'],
  progress: '0', // text while editing — parsed on save so clearing doesn't snap to 0
}

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([])
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...blank })
  const { t } = useLang()

  const load = useCallback(async () => {
    setGoals(await db.goals.filter((g) => !g.deleted).toArray())
  }, [])
  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  function startCreate() {
    setEditingId(null)
    setForm({ ...blank })
    setOpen(true)
  }

  function startEdit(g: Goal) {
    setEditingId(g.id)
    setForm({
      title: g.title,
      type: g.type,
      parentId: g.parentId ?? '',
      targetDate: g.targetDate ?? '',
      status: g.status,
      progress: String(g.progress),
    })
    setOpen(true)
  }

  async function save() {
    if (!form.title.trim()) return
    const existing = editingId ? await db.goals.get(editingId) : undefined
    const goal: Goal = {
      id: editingId ?? uuid(),
      lifeArea: existing?.lifeArea,
      whyItMatters: existing?.whyItMatters,
      title: form.title.trim(),
      type: form.type,
      parentId: form.parentId || undefined,
      targetDate: form.targetDate || undefined,
      status: form.status,
      progress: Math.max(0, Math.min(100, parseInt(form.progress, 10) || 0)),
      deleted: 0,
      updatedAt: Date.now(),
    }
    await writeAndQueue(db.goals, 'goal', goal)
    await rollUpGoal(goal.id) // refresh: from linked tasks if any, then ancestors
    setOpen(false)
    syncNow()
  }

  async function remove() {
    if (!editingId) return
    const g = await db.goals.get(editingId)
    if (!g) return
    const tombstone: Goal = { ...g, deleted: 1, updatedAt: Date.now() }
    await writeAndQueue(db.goals, 'goal', tombstone)
    if (g.parentId) await rollUpGoal(g.parentId)
    setOpen(false)
    syncNow()
  }

  const byId = new Map(goals.map((g) => [g.id, g]))
  const parentOptions = goals.filter(
    (g) => g.id !== editingId && ORDER.indexOf(g.type) === ORDER.indexOf(form.type) - 1,
  )
  const hasLinkedTasks = false // hint text only; roll-up decides for real

  return (
    <div>
      <div className="greet page-head">
        <div>
          <h1>{t('goals.title')}</h1>
          <div className="sub">{t('goals.sub')}</div>
        </div>
        <button className="btn btn-primary" onClick={startCreate}>{t('goals.add')}</button>
      </div>

      {ORDER.map((lvl) => {
        const group = goals.filter((g) => g.type === lvl)
        if (group.length === 0) return null
        return (
          <div key={lvl}>
            <div className="section-h">{t('level.' + lvl)}</div>
            <div className="stack goals-group" style={{ marginTop: 0 }}>
              {group.map((g) => (
                <button key={g.id} className="card goal-card" onClick={() => startEdit(g)}>
                  <div className="top">
                    <span className="t">{g.title}</span>
                    <span className="pct num">{g.progress}%</span>
                  </div>
                  <div className="pbar"><i style={{ width: `${g.progress}%` }} /></div>
                  <div className="meta">
                    {g.parentId && byId.get(g.parentId) ? `↑ ${byId.get(g.parentId)!.title}` : ''}
                    {g.targetDate ? `  ·  ${g.targetDate}` : ''}
                    {`  ·  ${t('status.' + g.status)}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      })}
      {goals.length === 0 && <div className="empty">{t('goals.empty')}</div>}

      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-body">
            <input
              type="text"
              autoFocus
              placeholder={t('goals.titlePh')}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && save()}
            />
            <div className="form-grid">
              <div className="f-pair">
                <div className="f">
                  <label className="fl">{t('goals.level')}</label>
                  <Select
                    ariaLabel={t('goals.level')}
                    value={form.type}
                    onChange={(v) => setForm({ ...form, type: v as GoalType, parentId: '' })}
                    options={ORDER.map((lvl) => ({ value: lvl, label: t('level.' + lvl) }))}
                  />
                </div>
                <div className="f">
                  <label className="fl">{t('goals.status')}</label>
                  <Select
                    ariaLabel={t('goals.status')}
                    value={form.status}
                    onChange={(v) => setForm({ ...form, status: v as Goal['status'] })}
                    options={STATUSES.map((s) => ({ value: s, label: t('status.' + s) }))}
                  />
                </div>
              </div>
              {parentOptions.length > 0 && (
                <div className="f">
                  <label className="fl">{t('goals.parent')}</label>
                  <Select
                    ariaLabel={t('goals.parent')}
                    value={form.parentId}
                    onChange={(v) => setForm({ ...form, parentId: v })}
                    options={[{ value: '', label: t('goals.noParent') }, ...parentOptions.map((p) => ({ value: p.id, label: `↑ ${p.title}` }))]}
                  />
                </div>
              )}
              <div className="f-pair">
                <div className="f">
                  <label className="fl">{t('goals.targetDate')}</label>
                  <div className={`date-wrap ${form.targetDate ? '' : 'no-val'}`} data-ph={t('task.tapToSet')}>
                    <input
                      type="date"
                      value={form.targetDate}
                      onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
                    />
                  </div>
                </div>
                <div className="f">
                  <label className="fl">{t('goals.progress')}</label>
                  <input
                    type="number" min="0" max="100" inputMode="numeric" placeholder="0"
                    value={form.progress}
                    onChange={(e) => setForm({ ...form, progress: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <p className="hint">{hasLinkedTasks ? '' : t('goals.hint')}</p>
            </div>
            <div className="row sheet-actions" style={{ justifyContent: editingId ? 'space-between' : 'flex-end' }}>
              {editingId && <button className="btn btn-danger" onClick={remove}>{t('common.delete')}</button>}
              <span style={{ display: 'flex', gap: '0.6rem' }}>
                <button className="btn" onClick={() => setOpen(false)}>{t('common.cancel')}</button>
                <button className="btn btn-primary" onClick={save}>{editingId ? t('goals.save') : t('goals.addGoal')}</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
