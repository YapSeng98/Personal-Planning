import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db, uuid, patchAndQueue, CHANGED, type DrawingNote, type SketchFolder } from '../db/db'
import { syncNow } from '../sync/engine'
import { useLang } from '../lib/i18n'
import { toEditorHtml } from '../lib/noteHtml'
import FolderForm from '../components/FolderForm'
import FolderCover from '../components/FolderCover'
import Icon from '../components/Icon'
import { childFolders, folderPath, subtreeIds } from '../lib/folders'
import { deleteStoredFiles } from '../lib/files'

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
  const path = currentFolder ? folderPath(currentFolder.id, folders) : []
  const parentId = path.length > 1 ? path[path.length - 2].id : undefined
  const subfolders = childFolders(folderId, folders)
  // A note whose folder no longer exists shows at the top level rather than
  // vanishing.
  const folderIds = new Set(folders.map((f) => f.id))
  const items = folderId
    ? allNotes.filter((d) => d.folderId === folderId)
    : allNotes.filter((d) => !d.folderId || !folderIds.has(d.folderId))
  // Card counts include everything nested inside the folder.
  const countIn = (id: string) => {
    const ids = subtreeIds(id, folders)
    return allNotes.filter((d) => d.folderId && ids.has(d.folderId)).length
  }
  const folderUrl = (id?: string) => (id ? `/sketches/folder/${id}` : '/sketches')

  async function remove(d: DrawingNote, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm(t('sketch.deleteConfirm', { title: d.title || t('sketch.untitled') }))) return
    deleteStoredFiles(d.attachments)
    await patchAndQueue(db.drawings, 'drawing', d.id, { deleted: 1 })
    syncNow()
  }

  async function removeFolder(f: SketchFolder, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const notes = allNotes.filter((x) => x.folderId === f.id)
    const kids = folders.filter((x) => x.parentId === f.id)
    const n = notes.length + kids.length
    const msg = n > 0
      ? t('sketch.folderDeleteConfirmWithItems', { name: f.name, n })
      : t('sketch.folderDeleteConfirm', { name: f.name })
    if (!window.confirm(msg)) return
    // Deleting a folder moves its notes and sub-folders up one level rather
    // than deleting them — a folder is organization, not ownership.
    const up = f.parentId && folderIds.has(f.parentId) ? f.parentId : undefined
    for (const d of notes) {
      await patchAndQueue(db.drawings, 'drawing', d.id, { folderId: up })
    }
    for (const k of kids) {
      await patchAndQueue(db.folders, 'folder', k.id, { parentId: up })
    }
    await patchAndQueue(db.folders, 'folder', f.id, { deleted: 1 })
    syncNow()
  }

  function createNew(kind: 'draw' | 'text') {
    const params = new URLSearchParams({ type: kind })
    if (folderId) params.set('folder', folderId)
    navigate(`/sketches/${uuid()}?${params.toString()}`)
  }

  const newButtons = (
    <div className="sketch-new-row">
      <button className="btn btn-primary" onClick={() => createNew('draw')}><Icon name="pencil" size={16} /> {t('sketch.newDraw')}</button>
      <button className="btn btn-primary" onClick={() => createNew('text')}><Icon name="reviews" size={16} /> {t('sketch.newType')}</button>
      <button className="btn" onClick={() => setFolderSheet('new')}><Icon name="folder" size={16} /> {t('sketch.newFolder')}</button>
    </div>
  )

  return (
    <div>
      {currentFolder?.cover && <FolderCover folder={currentFolder} />}
      <div className="greet page-head">
        {currentFolder ? (
          <div className="hd-title-wrap">
            <nav className="folder-crumbs" aria-label="Breadcrumb">
              <button type="button" onClick={() => navigate('/sketches')}>{t('sketch.title')}</button>
              {path.slice(0, -1).map((f) => (
                <span key={f.id}>
                  <span className="sep" aria-hidden>›</span>
                  <button type="button" onClick={() => navigate(folderUrl(f.id))}>{f.name}</button>
                </span>
              ))}
            </nav>
            <div className="hd-title-row">
              <button className="hd-back" onClick={() => navigate(folderUrl(parentId))} aria-label={t('common.cancel')}><Icon name="chevronLeft" size={18} /></button>
              <h1><Icon name="folder" size={22} className="hd-title-icon" /> {currentFolder.name}</h1>
            </div>
            {!currentFolder.cover && <FolderCover folder={currentFolder} />}
          </div>
        ) : (
          <div>
            <h1>{t('sketch.title')}</h1>
            <div className="sub">{t('sketch.sub')}</div>
          </div>
        )}
        {newButtons}
      </div>

      {subfolders.length > 0 && (
        <div className="sketch-folder-grid">
          {subfolders.map((f) => (
            <div key={f.id} className="card sketch-folder-card">
              <button type="button" className="sketch-folder-open" onClick={() => navigate(`/sketches/folder/${f.id}`)}>
                <span className="sketch-folder-icon"><Icon name="folder" size={17} /></span>
                <span className="sketch-folder-name">{f.name}</span>
                <span className="sketch-folder-count num">{countIn(f.id)}</span>
              </button>
              <div className="sketch-folder-actions">
                <button type="button" className="sketch-del" onClick={() => setFolderSheet(f)} aria-label={t('sketch.renameFolder')}><Icon name="pencil" size={14} /></button>
                <button type="button" className="sketch-del" onClick={(e) => removeFolder(f, e)} aria-label={t('common.delete')}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length === 0 && subfolders.length === 0 ? (
        <div className="card empty-cta">
          <p>{folderId ? t('sketch.emptyFolder') : t('sketch.empty')}</p>
        </div>
      ) : items.length > 0 && (
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
                  <Icon name={d.kind === 'text' ? 'reviews' : 'pencil'} size={13} className="sketch-name-ico" /> {d.title || t('sketch.untitled')}
                </button>
                <button type="button" className="sketch-del" onClick={(e) => remove(d, e)} aria-label={t('common.delete')}><Icon name="trash" size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {folderSheet !== 'closed' && (
        <FolderForm
          folder={folderSheet === 'new' ? null : folderSheet}
          parentId={folderId}
          onClose={() => setFolderSheet('closed')}
        />
      )}
    </div>
  )
}
