import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { shrinkImage } from '../lib/attach'
import { storeFile, deleteStoredFiles, MAX_STORED_BYTES } from '../lib/files'
import AttachmentChip from '../components/AttachmentChip'
import { folderOptions } from '../lib/folders'
import { db, writeAndQueue, type DrawingNote, type NoteAttachment, type SketchFolder } from '../db/db'
import { syncNow } from '../sync/engine'
import { useLang } from '../lib/i18n'
import { toEditorHtml } from '../lib/noteHtml'
import Select from '../components/Select'
import Icon from '../components/Icon'

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
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const [attachErr, setAttachErr] = useState('')
  const [dragOver, setDragOver] = useState(false)
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
  // Flips true once the stored note (if any) has been read for this id —
  // the editor seeds itself from it only after that.
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    db.folders.filter((f) => !f.deleted).toArray().then((f) => {
      f.sort((a, b) => a.name.localeCompare(b.name))
      setFolders(f)
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    ;(async () => {
      if (!id) return
      const existing = await db.drawings.get(id)
      if (cancelled) return
      setLoaded(true)
      if (!existing || existing.deleted) return
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

  // Seeds the editor's DOM from the loaded note. Waits for `loaded`: a new
  // note's URL carries ?type=text, so `kind` is already 'text' (editor
  // mounted) before the load finishes — seeding then would show an empty
  // note on reload. Staying off `text` means it won't stomp the DOM (and the
  // caret) on every keystroke.
  useEffect(() => {
    if (kind !== 'text' || !loaded) return
    const el = editorRef.current
    if (!el) return
    el.innerHTML = toEditorHtml(text, wasHtmlRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind, loaded])

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

  /** Appended at the end rather than at the caret: opening the native file
      picker makes where the caret was unreliable to restore across browsers. */
  async function addImage(file: File) {
    // Shrunk like review screenshots: full-size images make a note too big
    // to sync (see lib/compact.ts).
    const { dataUrl } = await shrinkImage(file)
    const el = editorRef.current
    if (!el) return
    const img = document.createElement('img')
    img.src = dataUrl
    el.appendChild(img)
    el.appendChild(document.createElement('br'))
    await autosaveText(el.innerHTML)
  }

  /** Files from anywhere — the 📎 picker, a paste, a drop. Images go into
      the note itself (shrunk, so the note stays small enough to sync): at
      the caret when pasting into the text, otherwise at the end. Anything
      else becomes an attachment chip. */
  async function addFiles(files: File[], atCaret = false) {
    setAttachErr('')
    const added: NoteAttachment[] = []
    let insertedImage = false
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        if (atCaret) {
          const { dataUrl } = await shrinkImage(file)
          document.execCommand('insertImage', false, dataUrl)
          insertedImage = true
        } else {
          await addImage(file)
        }
      } else if (file.size > MAX_STORED_BYTES) {
        setAttachErr(t('rev.attachTooBig', { name: file.name }))
      } else {
        // Non-image files go to Storage, not inline in the note.
        added.push(await storeFile(file))
      }
    }
    // Read the latest list from the ref — several files arrive in one go, and
    // each add awaits, so the `attachments` state captured here is stale.
    const next = added.length ? [...attachmentsRef.current, ...added] : undefined
    if (next) setAttachments(next)
    if (next || insertedImage) await autosaveText(editorRef.current?.innerHTML, next)
  }

  async function removeAttachment(attId: string) {
    deleteStoredFiles(attachments.filter((a) => a.id === attId))
    const next = attachments.filter((a) => a.id !== attId)
    setAttachments(next)
    await autosaveText(undefined, next)
  }

  // Paste a file anywhere on the page (text, title, toolbar). Only file
  // pastes are intercepted — pasting text behaves as normal.
  const addFilesRef = useRef(addFiles)
  addFilesRef.current = addFiles
  useEffect(() => {
    if (kind !== 'text') return
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (!files.length) return
      e.preventDefault()
      const inEditor = !!editorRef.current?.contains(e.target as Node)
      addFilesRef.current(files, inEditor)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [kind])

  async function remove() {
    if (!id) return
    if (!window.confirm(t('sketch.deleteConfirm', { title: title || t('sketch.untitled') }))) return
    const existing = await db.drawings.get(id)
    if (existing) {
      deleteStoredFiles(existing.attachments)
      await writeAndQueue(db.drawings, 'drawing', { ...existing, deleted: 1, updatedAt: Date.now() })
      syncNow()
    }
    navigate(folderId ? `/sketches/folder/${folderId}` : '/sketches')
  }

  // Typed notes accept files dropped anywhere on the page. preventDefault on
  // dragover is what stops the browser from opening the file instead.
  const dropProps = kind === 'text' ? {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return
      e.preventDefault()
      setDragOver(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
    },
    onDrop: (e: React.DragEvent) => {
      const files = Array.from(e.dataTransfer.files)
      setDragOver(false)
      if (!files.length) return
      e.preventDefault()
      addFiles(files)
    },
  } : {}

  return (
    <div className={dragOver ? 'sketch-drop-active' : undefined} {...dropProps}>
      <div className="greet page-head sketch-detail-head">
        <div className="hd-title-wrap">
          <div className="hd-title-row">
            <button className="hd-back" onClick={() => navigate(folderId ? `/sketches/folder/${folderId}` : '/sketches')} aria-label={t('common.cancel')}><Icon name="chevronLeft" size={18} /></button>
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
            options={[{ value: '', label: t('sketch.noFolder') }, ...folderOptions(folders)]}
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
              <button type="button" className="sketch-tool-btn" onClick={() => fileInputRef.current?.click()} aria-label={t('sketch.addAttachment')} title={t('sketch.addAttachment')}>📎</button>
            </div>
          </div>
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            multiple
            onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
          />
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            multiple
            onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = '' }}
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
          {attachErr && <div className="ai-status err sketch-attach-err">{attachErr}</div>}
          {attachments.length > 0 && (
            <div className="sketch-attachments">
              {attachments.map((a) => (
                <AttachmentChip key={a.id} a={a} onRemove={() => removeAttachment(a.id)} />
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
