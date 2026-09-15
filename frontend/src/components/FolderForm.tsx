import { useState } from 'react'
import { db, uuid, writeAndQueue, type SketchFolder } from '../db/db'
import { syncNow } from '../sync/engine'
import { useLang } from '../lib/i18n'

// Create/edit sheet for a sketch folder — same sheet-backdrop/sheet markup
// as ProjectForm, so it fits the app's existing sheet styling for free.

export default function FolderForm({
  folder,
  onClose,
}: {
  folder: SketchFolder | null
  onClose: () => void
}) {
  const editing = folder !== null
  const [name, setName] = useState(folder?.name ?? '')
  const [submitting, setSubmitting] = useState(false)
  const { t } = useLang()

  async function save() {
    if (!name.trim() || submitting) return
    setSubmitting(true)
    try {
      const record: SketchFolder = {
        id: folder?.id ?? uuid(),
        sysId: folder?.sysId,
        name: name.trim(),
        deleted: 0,
        updatedAt: Date.now(),
      }
      await writeAndQueue(db.folders, 'folder', record)
      syncNow()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <input
            type="text"
            autoFocus
            placeholder={t('sketch.folderNamePh')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            aria-label={t('sketch.folderNamePh')}
          />
        </div>
        <div className="row sheet-actions" style={{ justifyContent: 'flex-end' }}>
          <span style={{ display: 'flex', gap: '0.6rem' }}>
            <button className="btn" onClick={onClose} disabled={submitting}>{t('common.cancel')}</button>
            <button className="btn btn-primary" onClick={save} disabled={submitting}>
              {editing ? t('sketch.folderSave') : t('sketch.addFolder')}
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
