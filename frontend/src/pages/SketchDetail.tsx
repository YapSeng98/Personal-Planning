import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db, notifyChange, type DrawingNote } from '../db/db'
import { useLang } from '../lib/i18n'

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
  const navigate = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const historyRef = useRef<string[]>([])
  const activePointerId = useRef<number | null>(null)
  const [title, setTitle] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [sizeKey, setSizeKey] = useState<SizeKey>('md')
  const [canUndo, setCanUndo] = useState(false)
  const [penMode, setPenMode] = useState(() => localStorage.getItem(HAS_PEN_KEY) === '1')
  const { t } = useLang()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!id) return
      const existing = await db.drawings.get(id)
      if (cancelled) return
      setTitle(existing?.title ?? '')
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      if (existing?.dataUrl) {
        const img = new Image()
        img.onload = () => { if (!cancelled) ctx.drawImage(img, 0, 0, canvas.width, canvas.height) }
        img.src = existing.dataUrl
      }
    })()
    return () => { cancelled = true }
  }, [id])

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
    await autosave()
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
      await autosave()
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
    await autosave()
  }

  async function autosave() {
    const canvas = canvasRef.current
    if (!canvas || !id) return
    const record: DrawingNote = {
      id,
      title,
      dataUrl: canvas.toDataURL('image/png'),
      updatedAt: Date.now(),
    }
    await db.drawings.put(record)
    notifyChange()
  }

  async function remove() {
    if (!id) return
    if (!window.confirm(t('sketch.deleteConfirm', { title: title || t('sketch.untitled') }))) return
    await db.drawings.delete(id)
    notifyChange()
    navigate('/sketches')
  }

  return (
    <div>
      <div className="greet page-head">
        <div className="hd-title-wrap">
          <div className="hd-title-row">
            <button className="hd-back" onClick={() => navigate('/sketches')} aria-label={t('common.cancel')}>‹</button>
            <input
              className="sketch-title-input"
              value={title}
              placeholder={t('sketch.untitled')}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={autosave}
            />
          </div>
        </div>
        <button className="btn btn-danger-soft" onClick={remove}>{t('common.delete')}</button>
      </div>

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
    </div>
  )
}
