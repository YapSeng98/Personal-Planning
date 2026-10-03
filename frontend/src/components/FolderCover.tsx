import { useRef, useState } from 'react'
import { db, writeAndQueue, type SketchFolder } from '../db/db'
import { syncNow } from '../sync/engine'
import { shrinkImage } from '../lib/attach'
import { useLang } from '../lib/i18n'
import Icon from './Icon'

/** Notion-style cover banner for a folder page: add / change / remove an
    image, and drag it vertically to choose which part shows. */
export default function FolderCover({ folder }: { folder: SketchFolder }) {
  const { t } = useLang()
  const fileRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLDivElement>(null)
  // While repositioning, the live (unsaved) focus point.
  const [dragY, setDragY] = useState<number | null>(null)
  const drag = useRef<{ startY: number; startPos: number; range: number } | null>(null)

  async function save(patch: Partial<SketchFolder>) {
    await writeAndQueue(db.folders, 'folder', { ...folder, ...patch, updatedAt: Date.now() })
    syncNow()
  }

  async function pick(file: File) {
    const { dataUrl } = await shrinkImage(file)
    await save({ cover: dataUrl, coverY: 50 })
  }

  /** How many px of the image are hidden vertically at the banner's width
      (background-size: cover) — dragging that far moves 0% → 100%. */
  function overflowPx(): Promise<number> {
    const el = bannerRef.current
    if (!el || !folder.cover) return Promise.resolve(0)
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const { width: w, height: h } = el.getBoundingClientRect()
        const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
        resolve(Math.max(0, img.naturalHeight * scale - h))
      }
      img.onerror = () => resolve(0)
      img.src = folder.cover!
    })
  }

  async function startReposition() {
    setDragY(folder.coverY ?? 50)
    const range = await overflowPx()
    drag.current = { startY: 0, startPos: folder.coverY ?? 50, range: range || 1 }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (dragY === null || !drag.current) return
    if ((e.target as HTMLElement).closest('button')) return // Save / Cancel
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { ...drag.current, startY: e.clientY, startPos: dragY }
  }
  function onPointerMove(e: React.PointerEvent) {
    if (dragY === null || !drag.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    const { startY, startPos, range } = drag.current
    // Dragging down reveals more of the top → focus point moves toward 0%.
    const next = startPos - ((e.clientY - startY) / range) * 100
    setDragY(Math.round(Math.min(100, Math.max(0, next))))
  }

  const input = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      style={{ display: 'none' }}
      onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = '' }}
    />
  )

  if (!folder.cover) {
    return (
      <>
        <button type="button" className="cover-add" onClick={() => fileRef.current?.click()}>
          <Icon name="image" size={15} /> {t('sketch.addCover')}
        </button>
        {input}
      </>
    )
  }

  const repositioning = dragY !== null
  return (
    <div
      ref={bannerRef}
      className={`folder-cover ${repositioning ? 'repositioning' : ''}`}
      style={{ backgroundImage: `url(${folder.cover})`, backgroundPositionY: `${dragY ?? folder.coverY ?? 50}%` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      {repositioning ? (
        <>
          <span className="cover-hint"><Icon name="move" size={14} /> {t('sketch.dragToReposition')}</span>
          <div className="cover-actions on">
            <button type="button" onClick={() => { save({ coverY: dragY! }); setDragY(null) }}>{t('sketch.savePosition')}</button>
            <button type="button" onClick={() => setDragY(null)}>{t('common.cancel')}</button>
          </div>
        </>
      ) : (
        <div className="cover-actions">
          <button type="button" onClick={() => fileRef.current?.click()}>{t('sketch.changeCover')}</button>
          <button type="button" onClick={startReposition}>{t('sketch.reposition')}</button>
          <button type="button" onClick={() => save({ cover: undefined, coverY: undefined })}>{t('sketch.removeCover')}</button>
        </div>
      )}
      {input}
    </div>
  )
}
