import { useEffect, useState } from 'react'
import { db, editTaskList, CHANGED } from '../db/db'
import { syncNow } from '../sync/engine'
import { addStep, toggleStep, renameStep, removeStep, live, stepCount, type CheckItem } from '../lib/items'
import { useLang, type TFn } from '../lib/i18n'
import Icon from './Icon'
import AutoTextarea from './AutoTextarea'

function StepRow({ step, onToggle, onRename, onRemove, t }: {
  step: CheckItem; onToggle: () => void; onRename: (text: string) => void; onRemove: () => void; t: TFn
}) {
  const [text, setText] = useState(step.text)
  // a rename from another device shows up (unless it's being typed over here)
  useEffect(() => setText(step.text), [step.text])
  const commit = () => {
    if (!text.trim()) setText(step.text)
    else if (text.trim() !== step.text) onRename(text)
  }
  return (
    <div className={`step ${step.done ? 'done' : ''}`}>
      <button type="button" className={`check step-check ${step.done ? 'on' : ''}`} onClick={onToggle}
        aria-pressed={!!step.done} aria-label={t(step.done ? 'step.undo' : 'step.do', { text: step.text })}>✓</button>
      <AutoTextarea
        className="step-text"
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }}
        aria-label={t('step.edit')}
      />
      <button type="button" className="step-x" onClick={onRemove} aria-label={t('step.remove', { text: step.text })}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}

/** A task's steps. On a task that exists each change saves at once (and
    another device's changes to other steps are kept: the list merges item
    by item); on a new task the form holds them until the task is added. */
export default function Checklist({ taskId, value, onChange }: {
  taskId?: string
  value?: CheckItem[]
  onChange?: (v: CheckItem[]) => void
}) {
  const [stored, setStored] = useState<CheckItem[]>([])
  const [draft, setDraft] = useState('')
  const { t } = useLang()

  useEffect(() => {
    if (!taskId) return
    let alive = true
    const load = () => { db.tasks.get(taskId).then((x) => { if (alive) setStored(x?.checklist ?? []) }) }
    load()
    window.addEventListener(CHANGED, load)
    return () => { alive = false; window.removeEventListener(CHANGED, load) }
  }, [taskId])

  const list = taskId ? stored : (value ?? [])
  async function change(fn: (l: CheckItem[]) => CheckItem[]) {
    if (!taskId) return onChange?.(fn(list))
    const saved = await editTaskList(taskId, 'checklist', fn)
    if (saved) setStored(saved.checklist ?? [])
    syncNow()
  }
  function add() {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    change((l) => addStep(l, text))
  }

  const steps = live(list)
  const { done, all } = stepCount(list)
  return (
    <div className="f checklist">
      <label className="fl">
        {t('step.title')}
        {all > 0 && <span className="step-count num">{done}/{all}</span>}
      </label>
      {all > 0 && (
        <div className="step-bar" aria-hidden><i style={{ width: `${(done / all) * 100}%` }} /></div>
      )}
      {steps.map((s) => (
        <StepRow
          key={s.id}
          step={s}
          t={t}
          onToggle={() => change((l) => toggleStep(l, s.id))}
          onRename={(text) => change((l) => renameStep(l, s.id, text))}
          onRemove={() => change((l) => removeStep(l, s.id))}
        />
      ))}
      <div className="step step-new">
        <span className="step-plus" aria-hidden><Icon name="plus" size={14} /></span>
        <input
          className="step-text"
          value={draft}
          placeholder={t('step.addPh')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          onBlur={add}
          aria-label={t('step.add')}
        />
      </div>
    </div>
  )
}
