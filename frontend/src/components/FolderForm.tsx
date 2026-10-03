import { useEffect, useState } from 'react'
import { db, uuid, writeAndQueue, type SketchFolder } from '../db/db'
import { syncNow } from '../sync/engine'
import { useLang } from '../lib/i18n'
import { folderOptions } from '../lib/folders'
import Select from './Select'

// Create/edit sheet for a sketch folder — same sheet-backdrop/sheet markup
// as ProjectForm, so it fits the app's existing sheet styling for free.

export default function FolderForm({
  folder,
  parentId: initialParent,
  onClose,
}: {
  folder: SketchFolder | null
  /** Where a new folder goes (the folder page it was created from). */
  parentId?: string
  onClose: () => void
}) {
  const editing = folder !== null
  const [name, setName] = useState(folder?.name ?? '')
  const [parentId, setParentId] = useState(folder ? folder.parentId : initialParent)
  const [folders, setFolders] = useState<SketchFolder[]>([])
  useEffect(() => {
    db.folders.filter((f) => !f.deleted).toArray().then(setFolders)
  }, [])
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
        parentId: parentId || undefined,
        cover: folder?.cover,
        coverY: folder?.coverY,
        coverH: folder?.coverH,
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
          {folders.length > (editing ? 1 : 0) && (
            <div className="f" style={{ marginTop: '0.9rem' }}>
              <label className="fl">{t('sketch.folderInside')}</label>
              <Select
                ariaLabel={t('sketch.folderInside')}
                value={parentId ?? ''}
                onChange={(v) => setParentId(v || undefined)}
                // A folder can't go inside itself or its own sub-folders.
                options={[{ value: '', label: t('sketch.topLevel') }, ...folderOptions(folders, folder?.id)]}
              />
            </div>
          )}
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
