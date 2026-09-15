import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { db, uuid, writeAndQueue, type DrawingNote, type NoteAttachment, type SketchFolder } from '../db/db'
import { syncNow } from '../sync/engine'
import { useLang } from '../lib/i18n'
import { toEditorHtml } from '../lib/noteHtml'
import Select from '../components/Select'

const CANVAS_W = 900
const CANVAS_H = 1200
const COLORS = ['#1B1B1F', '#D6472E', '#C07508', '#059669', '#2563EB']
const SIZES = [
  { key: 'sm', pen: 3, eraser: 18, dot: 8 },
  { key: 'md', pen: 6, eraser: 32, dot: 13 },
  { key: 'lg', pen: 12, eraser: 48, dot: 18 },
] as const
type SizeKey = (typeof SIZES)[number]['key']
const HISTORY_CAP = 20
// Once a real stylus (Apple Pencil, S-Pen, Surface Pen, ...) has touched the
// canvas, the device clearly has one — remember that forever so a resting
// palm (pointerType 'touch') stops being treated as drawing input.
const HAS_PEN_KEY = 'planner_has_pen'

export default function SketchDetail() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const historyRef = useRef<string[]>([])
  const activePointerId = useRef<number | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  // Loaded once per note to seed the (uncontrolled) rich text editor's DOM —
  // never updated on input, only on load, so it can't fight the editor for
  // control of its own content while the user types.
  const [text, setText] = useState('')
  // Read only by the DOM-seeding effect below, alongside `text` — see its
  // comment for why this isn't state.
  const wasHtmlRef = useRef(false)
  const [attachments, setAttachments] = useState<NoteAttachment[]>([])
  // New notes pick their kind from the ?type= the gallery linked with;
  // existing notes always keep whatever they were saved as, ignoring the URL.
  const [kind, setKind] = useState<'draw' | 'text'>(searchParams.get('type') === 'text' ? 'text' : 'draw')
  const [color, setColor] = useState(COLORS[0])
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [sizeKey, setSizeKey] = useState<SizeKey>('md')
  const [canUndo, setCanUndo] = useState(false)
  const [penMode, setPenMode] = useState(() => localStorage.getItem(HAS_PEN_KEY) === '1')
  const [folderId, setFolderId] = useState<string | undefined>(searchParams.get('folder') || undefined)
  const [folders, setFolders] = useState<SketchFolder[]>([])
  const { t } = useLang()

  useEffect(() => {
    db.folders.filter((f) => !f.deleted).toArray().then((f) => {
      f.sort((a, b) => a.name.localeCompare(b.name))
      setFolders(f)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!id) return
      const existing = await db.drawings.get(id)
      if (cancelled || !existing || existing.deleted) return
      setTitle(existing.title ?? '')
      setKind(existing.kind ?? 'draw')
      setText(existing.text ?? '')
      wasHtmlRef.current = existing.format === 'html'
      setAttachments(existing.attachments ?? [])
      setFolderId(existing.folderId)
      if (existing.kind === 'text') return
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (existing.dataUrl) {
        const img = new Image()
        img.onload = () => { if (!cancelled) ctx.drawImage(img, 0, 0, canvas.width, canvas.height) }
        img.src = existing.dataUrl
      }
    })()
    return () => { cancelled = true }
  }, [id])

  // Seeds the editor's DOM from the loaded note. Runs on [id, kind] rather
  // than [text]: `kind` only flips to 'text' (mounting the editor div) once
  // the load above has already set `text` in the same batch, so this still
  // sees the fresh value — and staying off `text` means it won't stomp the
  // DOM (and the caret) on every keystroke.
  useEffect(() => {
    if (kind !== 'text') return
    const el = editorRef.current
    if (!el) return
    el.innerHTML = toEditorHtml(text, wasHtmlRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind])

  function getPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  function pushHistory() {
    const canvas = canvasRef.current
    if (!canvas) return
    historyRef.current.push(canvas.toDataURL('image/png'))
    if (historyRef.current.length > HISTORY_CAP) historyRef.current.shift()
    setCanUndo(true)
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === 'pen' && !penMode) {
      setPenMode(true)
      localStorage.setItem(HAS_PEN_KEY, '1')
    }
    // Once a real pen has been seen, treat touch as a resting palm, not
    // drawing input — just ignore it (touch-action:none on the canvas
    // already blocks it from panning the page too).
    if (e.pointerType === 'touch' && penMode) return
    // A stroke already in progress from another contact (e.g. a palm
    // landing mid-draw) shouldn't hijack it.
    if (activePointerId.current !== null) return
    activePointerId.current = e.pointerId
    // Best-effort: keeps tracking the stroke if the pointer drifts outside
    // the canvas bounds. Some input paths don't register a capture-eligible
    // pointer — drawing still works fine without it, so don't let a throw
    // here block the rest of the stroke setup.
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not capture-eligible */ }
    pushHistory()
    drawingRef.current = true
    lastPoint.current = getPos(e)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current || e.pointerId !== activePointerId.current) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const p = getPos(e)
    const size = SIZES.find((s) => s.key === sizeKey)!
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color
    ctx.lineWidth = tool === 'eraser' ? size.eraser : size.pen
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(lastPoint.current!.x, lastPoint.current!.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastPoint.current = p
  }

  async function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== activePointerId.current) return
    activePointerId.current = null
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPoint.current = null
    await autosaveDrawing()
  }

  async function undo() {
    const canvas = canvasRef.current
    const prev = historyRef.current.pop()
    if (!canvas || !prev) return
    setCanUndo(historyRef.current.length > 0)
    const ctx = canvas.getContext('2d')!
    const img = new Image()
    img.onload = async () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      await autosaveDrawing()
    }
    img.src = prev
  }

  async function clearCanvas() {
    if (!window.confirm(t('sketch.clearConfirm'))) return
    pushHistory()
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await autosaveDrawing()
  }

  async function autosaveDrawing(fid: string | undefined = folderId) {
    const canvas = canvasRef.current
    if (!canvas || !id) return
    const record: DrawingNote = {
      id,
      title,
      kind: 'draw',
      dataUrl: canvas.toDataURL('image/png'),
      folderId: fid,
      deleted: 0,
      updatedAt: Date.now(),
    }
    await writeAndQueue(db.drawings, 'drawing', record)
    syncNow()
  }

  async function autosaveText(nextText?: string, nextAttachments?: NoteAttachment[], fid: string | undefined = folderId) {
    if (!id) return
    const record: DrawingNote = {
      id,
      title,
      kind: 'text',
      text: nextText ?? editorRef.current?.innerHTML ?? text,
      format: 'html',
      attachments: nextAttachments ?? attachments,
      folderId: fid,
      deleted: 0,
      updatedAt: Date.now(),
    }
    await writeAndQueue(db.drawings, 'drawing', record)
    wasHtmlRef.current = true
    syncNow()
  }

  const autosave = () => (kind === 'text' ? autosaveText() : autosaveDrawing())

  /** Folder changes save immediately (not on blur, like everything else
      here) — there's no other natural commit point for a dropdown pick. */
  async function changeFolder(newFolderId: string) {
    const fid = newFolderId || undefined
    setFolderId(fid)
    if (kind === 'text') await autosaveText(undefined, undefined, fid)
    else await autosaveDrawing(fid)
  }

  function exec(cmd: string) {
    document.execCommand(cmd)
  }

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(file)
    })
  }

  /** Appended at the end rather than at the caret: opening the native file
      picker makes where the caret was unreliable to restore across browsers. */
  async function addImage(file: File) {
    const dataUrl = await readAsDataUrl(file)
    const el = editorRef.current
    if (!el) return
    const img = document.createElement('img')
    img.src = dataUrl
    el.appendChild(img)
    el.appendChild(document.createElement('br'))
    await autosaveText(el.innerHTML)
  }

  async function addAttachment(file: File) {
    const dataUrl = await readAsDataUrl(file)
    const next = [...attachments, { id: uuid(), name: file.name, type: file.type, dataUrl }]
    setAttachments(next)
    await autosaveText(undefined, next)
  }

  async function removeAttachment(attId: string) {
    const next = attachments.filter((a) => a.id !== attId)
    setAttachments(next)
    await autosaveText(undefined, next)
  }

  async function remove() {
    if (!id) return
    if (!window.confirm(t('sketch.deleteConfirm', { title: title || t('sketch.untitled') }))) return
    const existing = await db.drawings.get(id)
    if (existing) {
      await writeAndQueue(db.drawings, 'drawing', { ...existing, deleted: 1, updatedAt: Date.now() })
      syncNow()
    }
    navigate(folderId ? `/sketches/folder/${folderId}` : '/sketches')
  }

  return (
    <div>
      <div className="greet page-head">
        <div className="hd-title-wrap">
          <div className="hd-title-row">
            <button className="hd-back" onClick={() => navigate(folderId ? `/sketches/folder/${folderId}` : '/sketches')} aria-label={t('common.cancel')}>‹</button>
            <input
              className="sketch-title-input"
              value={title}
              placeholder={t('sketch.untitled')}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={autosave}
            />
          </div>
        </div>
        <div className="sketch-detail-actions">
          <Select
            ariaLabel={t('sketch.folder')}
            value={folderId ?? ''}
            onChange={changeFolder}
            options={[{ value: '', label: t('sketch.noFolder') }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
          />
          <button className="btn btn-danger-soft" onClick={remove}>{t('common.delete')}</button>
        </div>
      </div>

      {kind === 'text' ? (
        <>
          <div className="card sketch-toolbar sketch-rich-toolbar">
            <div className="sketch-tools">
              <button type="button" className="sketch-tool-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} aria-label={t('sketch.bold')}><b>B</b></button>
              <button type="button" className="sketch-tool-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} aria-label={t('sketch.italic')}><i>I</i></button>
              <button type="button" className="sketch-tool-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} aria-label={t('sketch.underline')}><u>U</u></button>
              <button type="button" className="sketch-tool-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} aria-label={t('sketch.bulletList')}>☰</button>
              <button type="button" className="sketch-tool-btn" onClick={() => imageInputRef.current?.click()} aria-label={t('sketch.addImage')}>🖼️</button>
              <button type="button" className="sketch-tool-btn" onClick={() => fileInputRef.current?.click()} aria-label={t('sketch.addAttachment')}>📎</button>
            </div>
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) addImage(f); e.target.value = '' }}
          />
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) addAttachment(f); e.target.value = '' }}
          />
          <div
            ref={editorRef}
            className="sketch-text-editor"
            contentEditable
            suppressContentEditableWarning
            data-placeholder={t('sketch.typePh')}
            onBlur={() => autosaveText()}
            autoFocus
          />
          {attachments.length > 0 && (
            <div className="sketch-attachments">
              {attachments.map((a) => (
                <div key={a.id} className="sketch-attachment-chip">
                  <a className="sketch-attachment-link" href={a.dataUrl} download={a.name} target="_blank" rel="noopener noreferrer">
                    <span className="sketch-attachment-icon">{a.type.startsWith('image/') ? '🖼️' : '📎'}</span>
                    <span className="sketch-attachment-name">{a.name}</span>
                  </a>
                  <button type="button" className="sketch-attachment-remove" onClick={() => removeAttachment(a.id)} aria-label={t('sketch.removeAttachment')}>×</button>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="card sketch-toolbar">
            <div className="sketch-colors">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`sketch-swatch ${tool === 'pen' && color === c ? 'on' : ''}`}
                  style={{ background: c }}
                  onClick={() => { setTool('pen'); setColor(c) }}
                  aria-label={`${t('sketch.color')}: ${c}`}
                />
              ))}
            </div>
            <div className="sketch-sizes">
              {SIZES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`sketch-size-btn ${sizeKey === s.key ? 'on' : ''}`}
                  onClick={() => setSizeKey(s.key)}
                  aria-label={`${t('sketch.size')}: ${s.key}`}
                >
                  <span className="sketch-size-dot" style={{ width: s.dot, height: s.dot }} />
                </button>
              ))}
            </div>
            <div className="sketch-tools">
              <button type="button" className={`sketch-tool-btn ${tool === 'eraser' ? 'on' : ''}`} onClick={() => setTool('eraser')} aria-label={t('sketch.eraser')}>🧽</button>
              <button type="button" className="sketch-tool-btn" onClick={undo} disabled={!canUndo} aria-label={t('sketch.undo')}>↺</button>
              <button type="button" className="sketch-tool-btn" onClick={clearCanvas}>{t('sketch.clear')}</button>
            </div>
          </div>

          <div className="sketch-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              className="sketch-canvas"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            />
          </div>
        </>
      )}
    </div>
  )
}
