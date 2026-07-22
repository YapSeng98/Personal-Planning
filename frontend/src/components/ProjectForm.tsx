import { useState } from 'react'
import { db, uuid, writeAndQueue, type Project, type ProjectColor } from '../db/db'
import { syncNow } from '../sync/engine'
import { PROJECT_COLORS, projectColorVar } from '../lib/projectColors'
import { useLang } from '../lib/i18n'

// Create/edit sheet for a Project — same sheet-backdrop/sheet markup as
// TaskForm/Goals, so it fits the app's existing sheet styling for free.

export default function ProjectForm({
  project,
  onClose,
  onSaved,
}: {
  project: Project | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const editing = project !== null
  const [title, setTitle] = useState(project?.title ?? '')
  const [color, setColor] = useState<ProjectColor>(project?.color ?? 'coral')
  const { t } = useLang()

  async function save() {
    if (!title.trim()) return
    const record: Project = {
      id: project?.id ?? uuid(),
      sysId: project?.sysId,
      title: title.trim(),
      color,
      archived: project?.archived ?? 0,
      deleted: 0,
      updatedAt: Date.now(),
    }
    await writeAndQueue(db.projects, 'project', record)
    syncNow()
    onSaved(record.id)
    onClose()
  }

  async function toggleArchive() {
    if (!project) return
    const updated: Project = { ...project, archived: project.archived ? 0 : 1, updatedAt: Date.now() }
    await writeAndQueue(db.projects, 'project', updated)
    syncNow()
    onClose()
  }

  async function remove() {
    if (!project) return
    if (!window.confirm(t('project.deleteConfirm', { title: project.title }))) return
    const tombstone: Project = { ...project, deleted: 1, updatedAt: Date.now() }
    await writeAndQueue(db.projects, 'project', tombstone)
    syncNow()
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <input
            type="text"
            autoFocus
            placeholder={t('project.titlePh')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            aria-label={t('project.titlePh')}
          />
          <div className="f">
            <label className="fl">{t('project.color')}</label>
            <div className="swatch-row" role="radiogroup" aria-label={t('project.color')}>
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`swatch ${color === c ? 'on' : ''}`}
                  style={{ background: projectColorVar(c) }}
                  onClick={() => setColor(c)}
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="row sheet-actions" style={{ justifyContent: editing ? 'space-between' : 'flex-end' }}>
          {editing && (
            <span style={{ display: 'flex', gap: '0.6rem' }}>
              <button className="btn btn-danger" onClick={remove}>{t('common.delete')}</button>
              <button className="btn" onClick={toggleArchive}>
                {project?.archived ? t('project.unarchive') : t('project.archive')}
              </button>
            </span>
          )}
          <span style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={save}>{editing ? t('project.save') : t('project.addProject')}</button>
          </span>
        </div>
      </div>
    </div>
  )
}
