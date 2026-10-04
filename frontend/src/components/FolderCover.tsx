import { useEffect, useRef, useState } from 'react'
import { db, patchAndQueue, type SketchFolder } from '../db/db'
import { syncNow } from '../sync/engine'
import { shrinkImage } from '../lib/attach'
import { useLang } from '../lib/i18n'
import Icon from './Icon'

/** Notion-style cover banner for a folder page: add / change / remove an
    image, drag it vertically to choose which part shows, and drag the bottom
    edge (or "Show full image") to set how tall the banner is. */
export default function FolderCover({ folder }: { folder: SketchFolder }) {
  const { t } = useLang()
  const fileRef = useRef<HTMLInputElement>(null)
  const bannerRef = useRef<HTMLDivElement>(null)
  // While repositioning, the live (unsaved) focus point.
  const [dragY, setDragY] = useState<number | null>(null)
  const drag = useRef<{ startY: number; startPos: number; range: number } | null>(null)
  // While resizing, the live (unsaved) height as % of width.
  const [resizeH, setResizeH] = useState<number | null>(null)
  const resize = useRef<{ startY: number; startPx: number; width: number } | null>(null)
  // The image's own height/width %, i.e. the banner height that shows all of it.
  const [fullH, setFullH] = useState(100)
  useEffect(() => {
    if (!folder.cover) return
    const img = new Image()
    img.onload = () => setFullH((img.naturalHeight / img.naturalWidth) * 100)
    img.src = folder.cover
  }, [folder.cover])

  async function save(patch: Partial<SketchFolder>) {
    await patchAndQueue(db.folders, 'folder', folder.id, patch)
    syncNow()
  }

  async function pick(file: File) {
    const { dataUrl } = await shrinkImage(file)
    await save({ cover: dataUrl, coverY: 50, coverH: undefined })
  }

  // Bottom-edge handle: banner height follows the pointer, between a thin
  // strip and the height that shows the whole image.
  const MIN_H = 8
  function onResizeDown(e: React.PointerEvent) {
    const el = bannerRef.current
    if (!el) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    const r = el.getBoundingClientRect()
    resize.current = { startY: e.clientY, startPx: r.height, width: r.width }
    setResizeH((r.height / r.width) * 100)
  }
  function onResizeMove(e: React.PointerEvent) {
    if (!resize.current || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    const { startY, startPx, width } = resize.current
    const h = ((startPx + e.clientY - startY) / width) * 100
    setResizeH(Math.min(fullH, Math.max(MIN_H, h)))
  }
  function onResizeUp() {
    if (resize.current && resizeH !== null) save({ coverH: Math.round(resizeH * 10) / 10 })
    resize.current = null
    setResizeH(null)
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
  const h = resizeH ?? folder.coverH
  const showingAll = h !== undefined && h >= fullH - 0.5
  return (
    <div
      ref={bannerRef}
      className={`folder-cover ${repositioning ? 'repositioning' : ''} ${resizeH !== null ? 'resizing' : ''}`}
      style={{
        backgroundImage: `url(${folder.cover})`,
        backgroundPositionY: `${dragY ?? folder.coverY ?? 50}%`,
        ...(h !== undefined ? { height: 'auto', aspectRatio: `100 / ${h}` } : {}),
      }}
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
          {!showingAll && <button type="button" onClick={startReposition}>{t('sketch.reposition')}</button>}
          {showingAll
            ? <button type="button" onClick={() => save({ coverH: undefined })}>{t('sketch.coverDefault')}</button>
            : <button type="button" onClick={() => save({ coverH: Math.round(fullH * 10) / 10, coverY: 50 })}>{t('sketch.showFullCover')}</button>}
          <button type="button" onClick={() => save({ cover: undefined, coverY: undefined })}>{t('sketch.removeCover')}</button>
        </div>
      )}
      {!repositioning && (
        <div
          className="cover-resize"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('sketch.resizeCover')}
          title={t('sketch.resizeCover')}
        />
      )}
      {input}
    </div>
  )
}
