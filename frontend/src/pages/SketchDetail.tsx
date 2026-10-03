import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { shrinkImage } from '../lib/attach'
import { storeFile, deleteStoredFiles, MAX_STORED_BYTES } from '../lib/files'
import AttachmentChip from '../components/AttachmentChip'
import DrawPad from '../components/DrawPad'
import { folderOptions } from '../lib/folders'
import { db, writeAndQueue, CHANGED, type DrawingNote, type NoteAttachment, type SketchFolder } from '../db/db'
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
  const futureRef = useRef<string[]>([]) // undone canvas states, for redo
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
  const [drawing, setDrawing] = useState(false)
  // What was last loaded/saved. Blur, typing pauses and app-switches save
  // only when the page differs from this — so a note that's merely open
  // (possibly stale, another device having edited it since) never
  // overwrites newer content, and can take in remote changes safely.
  const savedHtmlRef = useRef<string | null>(null)
  const savedTitleRef = useRef('')
  const savedDataUrlRef = useRef<string | undefined>(undefined)
  const titleRef = useRef('')
  const canvasDirtyRef = useRef(false)
  // Last known content, for saving after the editor/canvas has unmounted.
  const lastHtmlRef = useRef<string | null>(null)
  const lastCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const saveTimer = useRef<number | undefined>(undefined)
  // Image tapped in the note — gets a small resize toolbar.
  const [imgSel, setImgSel] = useState<{ img: HTMLImageElement; top: number; left: number; width: number; height: number } | null>(null)
  const editorWrapRef = useRef<HTMLDivElement>(null)
  // Undo/redo for typed notes. The browser's own undo misses changes made
  // in code (inserted drawings, image resize/remove, dropped files) and has
  // no button on phones — so keep snapshots of the note's HTML: one per
  // typing pause, one per such change.
  const pastRef = useRef<string[]>([])
  const textFutureRef = useRef<string[]>([])
  const snapRef = useRef<string | null>(null) // the state undo returns *from*
  const snapTimer = useRef<number | undefined>(undefined)
  const [textHist, setTextHist] = useState({ undo: false, redo: false })
  // Where the caret was in the note when the draw pad opened — the pad
  // takes focus, so this is how the drawing lands where you were typing.
  const savedRange = useRef<Range | null>(null)
  const [dragOver, setDragOver] = useState(false)
  // New notes pick their kind from the ?type= the gallery linked with;
  // existing notes always keep whatever they were saved as, ignoring the URL.
  const [kind, setKind] = useState<'draw' | 'text'>(searchParams.get('type') === 'text' ? 'text' : 'draw')
  const [color, setColor] = useState(COLORS[0])
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [sizeKey, setSizeKey] = useState<SizeKey>('md')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
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
      titleRef.current = savedTitleRef.current = existing.title ?? ''
      savedDataUrlRef.current = existing.dataUrl
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

  // Another device changed this note while it's open (a sync pulled it):
  // bring in what's new instead of letting the next autosave overwrite it
  // with this page's stale copy. Attachments always follow the stored note
  // (local adds/removes write it immediately); title, text and drawing only
  // update if you haven't changed them here since the last save.
  useEffect(() => {
    if (!id) return
    const refresh = async () => {
      const rec = await db.drawings.get(id)
      if (!rec || rec.deleted) return
      setAttachments(rec.attachments ?? [])
      setFolderId(rec.folderId)
      // Title/text/drawing: only replace what you haven't changed here.
      if (titleRef.current === savedTitleRef.current && (rec.title ?? '') !== titleRef.current) {
        titleRef.current = savedTitleRef.current = rec.title ?? ''
        setTitle(rec.title ?? '')
      }
      const el = editorRef.current
      if (rec.kind === 'text' && el && rec.text !== undefined && rec.text !== el.innerHTML && el.innerHTML === savedHtmlRef.current) {
        el.innerHTML = toEditorHtml(rec.text, rec.format === 'html')
        savedHtmlRef.current = lastHtmlRef.current = el.innerHTML
        snapshotRef.current() // another device's change is one undoable step here
      }
      const canvas = canvasRef.current
      if (rec.kind !== 'text' && canvas && !canvasDirtyRef.current && rec.dataUrl && rec.dataUrl !== savedDataUrlRef.current) {
        savedDataUrlRef.current = rec.dataUrl
        const img = new Image()
        img.onload = () => {
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        }
        img.src = rec.dataUrl
      }
    }
    window.addEventListener(CHANGED, refresh)
    return () => window.removeEventListener(CHANGED, refresh)
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
    savedHtmlRef.current = lastHtmlRef.current = el.innerHTML
    resetTextHistory(el.innerHTML)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind, loaded])

  function resetTextHistory(html: string) {
    pastRef.current = []
    textFutureRef.current = []
    snapRef.current = html
    setTextHist({ undo: false, redo: false })
  }
  /** Record the note's current HTML as a step, if it changed. */
  function snapshot() {
    window.clearTimeout(snapTimer.current)
    snapTimer.current = undefined
    const html = editorRef.current?.innerHTML
    if (html === undefined || html === snapRef.current) return
    if (snapRef.current !== null) pastRef.current.push(snapRef.current)
    if (pastRef.current.length > 100) pastRef.current.shift()
    snapRef.current = html
    textFutureRef.current = []
    setTextHist({ undo: pastRef.current.length > 0, redo: false })
  }
  async function stepText(dir: 'undo' | 'redo') {
    snapshot() // bank any typing not yet recorded
    const from = dir === 'undo' ? pastRef.current : textFutureRef.current
    const to = dir === 'undo' ? textFutureRef.current : pastRef.current
    const html = from.pop()
    const el = editorRef.current
    if (html === undefined || !el || snapRef.current === null) return
    to.push(snapRef.current)
    snapRef.current = html
    el.innerHTML = html
    lastHtmlRef.current = html
    setImgSel(null)
    setTextHist({ undo: pastRef.current.length > 0, redo: textFutureRef.current.length > 0 })
    await autosaveText(html)
  }
  function onEditorKey(e: React.KeyboardEvent) {
    if (!(e.metaKey || e.ctrlKey)) return
    const k = e.key.toLowerCase()
    if (k === 'z' || k === 'y') {
      e.preventDefault()
      stepText(k === 'y' || e.shiftKey ? 'redo' : 'undo')
    }
  }

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
    // A new stroke after undoing starts a new branch — nothing left to redo.
    futureRef.current = []
    setCanRedo(false)
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
    // Saving re-encodes the whole canvas — do it once you pause, not after
    // every stroke, so drawing stays smooth.
    canvasDirtyRef.current = true
    lastCanvasRef.current = canvasRef.current
    scheduleSave()
  }

  function paintCanvas(dataUrl: string) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    const img = new Image()
    img.onload = async () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      await autosaveDrawing()
    }
    img.src = dataUrl
  }

  function undo() {
    const canvas = canvasRef.current
    const prev = historyRef.current.pop()
    if (!canvas || !prev) return
    futureRef.current.push(canvas.toDataURL('image/png'))
    setCanUndo(historyRef.current.length > 0)
    setCanRedo(true)
    paintCanvas(prev)
  }

  function redo() {
    const canvas = canvasRef.current
    const next = futureRef.current.pop()
    if (!canvas || !next) return
    historyRef.current.push(canvas.toDataURL('image/png'))
    setCanUndo(true)
    setCanRedo(futureRef.current.length > 0)
    paintCanvas(next)
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
    const canvas = canvasRef.current ?? lastCanvasRef.current
    if (!canvas || !id) return
    const record: DrawingNote = {
      id,
      title: titleRef.current,
      kind: 'draw',
      dataUrl: canvas.toDataURL('image/png'),
      folderId: fid,
      deleted: 0,
      updatedAt: Date.now(),
    }
    canvasDirtyRef.current = false
    savedTitleRef.current = record.title
    savedDataUrlRef.current = record.dataUrl
    await writeAndQueue(db.drawings, 'drawing', record)
    syncNow()
  }

  async function autosaveText(nextText?: string, nextAttachments?: NoteAttachment[], fid: string | undefined = folderId) {
    if (!id) return
    if (nextText !== undefined) snapshot() // an edit made in code: one undo step
    const record: DrawingNote = {
      id,
      title: titleRef.current,
      kind: 'text',
      text: nextText ?? editorRef.current?.innerHTML ?? lastHtmlRef.current ?? text,
      format: 'html',
      attachments: nextAttachments ?? attachments,
      folderId: fid,
      deleted: 0,
      updatedAt: Date.now(),
    }
    savedHtmlRef.current = record.text ?? ''
    savedTitleRef.current = record.title
    await writeAndQueue(db.drawings, 'drawing', record)
    wasHtmlRef.current = true
    syncNow()
  }

  /** Blur / typing pause / leaving: save only if something here changed. */
  function autosave() {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = undefined
    const titleChanged = titleRef.current !== savedTitleRef.current
    if (kind === 'text') {
      const html = editorRef.current?.innerHTML ?? lastHtmlRef.current
      if (html === savedHtmlRef.current && !titleChanged) return
      autosaveText()
    } else {
      if (!canvasDirtyRef.current && !titleChanged) return
      autosaveDrawing()
    }
  }
  function scheduleSave() {
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(autosave, 1000)
  }
  // Switching apps, closing the tab or leaving the page: save what's pending.
  const autosaveRef = useRef(autosave)
  autosaveRef.current = autosave
  const snapshotRef = useRef(() => {})
  snapshotRef.current = snapshot
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') autosaveRef.current() }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      if (saveTimer.current !== undefined) autosaveRef.current()
    }
  }, [])

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

  function placeImgSel(img: HTMLImageElement) {
    const wrap = editorWrapRef.current
    if (!wrap) return
    const w = wrap.getBoundingClientRect(), r = img.getBoundingClientRect()
    setImgSel({ img, top: r.top - w.top, left: r.left - w.left, width: r.width, height: r.height })
  }
  function selectImage(target: HTMLElement) {
    if (target.tagName === 'IMG' && editorRef.current?.contains(target)) placeImgSel(target as HTMLImageElement)
    else setImgSel(null)
  }
  async function resizeImage(width: string) {
    if (!imgSel) return
    imgSel.img.style.width = width
    imgSel.img.style.height = 'auto'
    placeImgSel(imgSel.img)
    await autosaveText(editorRef.current?.innerHTML)
  }
  async function removeImage() {
    if (!imgSel) return
    imgSel.img.remove()
    setImgSel(null)
    await autosaveText(editorRef.current?.innerHTML)
  }

  function openDrawPad() {
    const sel = window.getSelection()
    const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null
    savedRange.current = r && editorRef.current?.contains(r.startContainer) ? r.cloneRange() : null
    setDrawing(true)
  }

  async function insertDrawing(dataUrl: string, cssWidth: number) {
    setDrawing(false)
    const el = editorRef.current
    if (!el) return
    const range = savedRange.current
    if (range) {
      el.focus()
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.execCommand('insertImage', false, dataUrl)
    } else {
      const img = document.createElement('img')
      img.src = dataUrl
      el.appendChild(img)
      el.appendChild(document.createElement('br'))
    }
    // Show it at the size it was drawn: the image is stored at the screen's
    // pixel density (2-3x on phones/Retina), which would otherwise display
    // it two or three times too big. Tap it to resize.
    const placed = [...el.querySelectorAll('img')].reverse().find((i) => i.getAttribute('src') === dataUrl)
    if (placed) placed.style.width = `${Math.round(cssWidth)}px`
    await autosaveText(el.innerHTML)
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
              onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; scheduleSave() }}
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
              <button type="button" className="sketch-tool-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => stepText('undo')} disabled={!textHist.undo} aria-label={t('sketch.undo')} title={t('sketch.undo')}>↶</button>
              <button type="button" className="sketch-tool-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => stepText('redo')} disabled={!textHist.redo} aria-label={t('sketch.redo')} title={t('sketch.redo')}>↷</button>
              <button type="button" className="sketch-tool-btn" onMouseDown={(e) => e.preventDefault()} onClick={openDrawPad} aria-label={t('sketch.drawInNote')} title={t('sketch.drawInNote')}>✏️</button>
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
          <div className="sketch-editor-wrap" ref={editorWrapRef}>
            <div
              ref={editorRef}
              className="sketch-text-editor"
              contentEditable
              suppressContentEditableWarning
              data-placeholder={t('sketch.typePh')}
              onBlur={autosave}
              onInput={() => {
                lastHtmlRef.current = editorRef.current?.innerHTML ?? null
                setImgSel(null)
                scheduleSave()
                window.clearTimeout(snapTimer.current)
                snapTimer.current = window.setTimeout(snapshot, 600)
              }}
              onKeyDown={onEditorKey}
              onClick={(e) => selectImage(e.target as HTMLElement)}
              autoFocus
            />
            {imgSel && (
              <>
                <div className="img-sel-box" style={{ top: imgSel.top, left: imgSel.left, width: imgSel.width, height: imgSel.height }} />
                <div className="img-sel-bar" style={{ top: Math.max(0, imgSel.top - 44), left: imgSel.left }} onMouseDown={(e) => e.preventDefault()}>
                  {([['S', '25%'], ['M', '50%'], ['L', '75%'], [t('sketch.imgFull'), '100%']] as const).map(([label, w]) => (
                    <button key={w} type="button" className={imgSel.img.style.width === w ? 'on' : ''} onClick={() => resizeImage(w)}>{label}</button>
                  ))}
                  <button type="button" onClick={removeImage} aria-label={t('sketch.imgRemove')}><Icon name="trash" size={14} /></button>
                </div>
              </>
            )}
          </div>
          {attachErr && <div className="ai-status err sketch-attach-err">{attachErr}</div>}
          {drawing && <DrawPad onInsert={insertDrawing} onClose={() => setDrawing(false)} />}
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
              <button type="button" className="sketch-tool-btn" onClick={undo} disabled={!canUndo} aria-label={t('sketch.undo')} title={t('sketch.undo')}>↺</button>
              <button type="button" className="sketch-tool-btn" onClick={redo} disabled={!canRedo} aria-label={t('sketch.redo')} title={t('sketch.redo')}>↻</button>
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
