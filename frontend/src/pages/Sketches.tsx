import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db, uuid, writeAndQueue, CHANGED, type DrawingNote, type SketchFolder } from '../db/db'
import { syncNow } from '../sync/engine'
import { useLang } from '../lib/i18n'
import { toEditorHtml } from '../lib/noteHtml'
import FolderForm from '../components/FolderForm'

export default function Sketches() {
  const { folderId } = useParams<{ folderId?: string }>()
  const navigate = useNavigate()
  const [allNotes, setAllNotes] = useState<DrawingNote[]>([])
  const [folders, setFolders] = useState<SketchFolder[]>([])
  const [folderSheet, setFolderSheet] = useState<'closed' | 'new' | SketchFolder>('closed')
  const { t } = useLang()

  const load = useCallback(async () => {
    const notes = await db.drawings.filter((d) => !d.deleted).toArray()
    notes.sort((a, b) => b.updatedAt - a.updatedAt)
    setAllNotes(notes)
    const f = await db.folders.filter((x) => !x.deleted).toArray()
    f.sort((a, b) => a.name.localeCompare(b.name))
    setFolders(f)
  }, [])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  const currentFolder = folderId ? folders.find((f) => f.id === folderId) : undefined
  const items = folderId ? allNotes.filter((d) => d.folderId === folderId) : allNotes.filter((d) => !d.folderId)
  const counts = allNotes.reduce<Record<string, number>>((acc, d) => {
    if (d.folderId) acc[d.folderId] = (acc[d.folderId] ?? 0) + 1
    return acc
  }, {})

  async function remove(d: DrawingNote, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm(t('sketch.deleteConfirm', { title: d.title || t('sketch.untitled') }))) return
    const tombstone: DrawingNote = { ...d, deleted: 1, updatedAt: Date.now() }
    await writeAndQueue(db.drawings, 'drawing', tombstone)
    syncNow()
  }

  async function removeFolder(f: SketchFolder, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const n = counts[f.id] ?? 0
    const msg = n > 0
      ? t('sketch.folderDeleteConfirmWithNotes', { name: f.name, n })
      : t('sketch.folderDeleteConfirm', { name: f.name })
    if (!window.confirm(msg)) return
    // Deleting a folder ungroups its notes rather than deleting them — a
    // folder is organization, not ownership of its contents.
    for (const d of allNotes.filter((x) => x.folderId === f.id)) {
      const ungrouped: DrawingNote = { ...d, folderId: undefined, updatedAt: Date.now() }
      await writeAndQueue(db.drawings, 'drawing', ungrouped)
    }
    const tombstone: SketchFolder = { ...f, deleted: 1, updatedAt: Date.now() }
    await writeAndQueue(db.folders, 'folder', tombstone)
    syncNow()
  }

  function createNew(kind: 'draw' | 'text') {
    const params = new URLSearchParams({ type: kind })
    if (folderId) params.set('folder', folderId)
    navigate(`/sketches/${uuid()}?${params.toString()}`)
  }

  const newButtons = (
    <div className="sketch-new-row">
      <button className="btn btn-primary" onClick={() => createNew('draw')}>✏️ {t('sketch.newDraw')}</button>
      <button className="btn btn-primary" onClick={() => createNew('text')}>⌨️ {t('sketch.newType')}</button>
      {!folderId && <button className="btn" onClick={() => setFolderSheet('new')}>📁 {t('sketch.newFolder')}</button>}
    </div>
  )

  return (
    <div>
      <div className="greet page-head">
        {currentFolder ? (
          <div className="hd-title-wrap">
            <div className="hd-title-row">
              <button className="hd-back" onClick={() => navigate('/sketches')} aria-label={t('common.cancel')}>‹</button>
              <h1>📁 {currentFolder.name}</h1>
            </div>
          </div>
        ) : (
          <div>
            <h1>{t('sketch.title')}</h1>
            <div className="sub">{t('sketch.sub')}</div>
          </div>
        )}
        {newButtons}
      </div>

      {!folderId && folders.length > 0 && (
        <div className="sketch-folder-grid">
          {folders.map((f) => (
            <div key={f.id} className="card sketch-folder-card">
              <button type="button" className="sketch-folder-open" onClick={() => navigate(`/sketches/folder/${f.id}`)}>
                <span className="sketch-folder-icon">📁</span>
                <span className="sketch-folder-name">{f.name}</span>
                <span className="sketch-folder-count num">{counts[f.id] ?? 0}</span>
              </button>
              <div className="sketch-folder-actions">
                <button type="button" className="sketch-del" onClick={() => setFolderSheet(f)} aria-label={t('sketch.renameFolder')}>✎</button>
                <button type="button" className="sketch-del" onClick={(e) => removeFolder(f, e)} aria-label={t('common.delete')}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 ? (
        <div className="card empty-cta">
          <p>{folderId ? t('sketch.emptyFolder') : t('sketch.empty')}</p>
        </div>
      ) : (
        <div className="sketch-grid">
          {items.map((d) => (
            <div key={d.id} className="card sketch-card">
              <button type="button" className="sketch-thumb" onClick={() => navigate(`/sketches/${d.id}`)} aria-label={d.title || t('sketch.untitled')}>
                {d.kind === 'text' ? (
                  <div className="sketch-thumb-text" dangerouslySetInnerHTML={{ __html: toEditorHtml(d.text || '', d.format === 'html') }} />
                ) : (
                  <img src={d.dataUrl} alt="" />
                )}
              </button>
              <div className="sketch-meta">
                <button type="button" className="sketch-name" onClick={() => navigate(`/sketches/${d.id}`)}>
                  {d.kind === 'text' ? '⌨️ ' : '✏️ '}{d.title || t('sketch.untitled')}
                </button>
                <button type="button" className="sketch-del" onClick={(e) => remove(d, e)} aria-label={t('common.delete')}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {folderSheet !== 'closed' && (
        <FolderForm
          folder={folderSheet === 'new' ? null : folderSheet}
          onClose={() => setFolderSheet('closed')}
        />
      )}
    </div>
  )
}
