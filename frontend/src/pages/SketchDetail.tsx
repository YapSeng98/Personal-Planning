import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db, notifyChange, type DrawingNote } from '../db/db'
import { useLang } from '../lib/i18n'

const CANVAS_W = 900
const CANVAS_H = 1200
const PEN_WIDTH = 6
const ERASER_WIDTH = 32
const COLORS = ['#1B1B1F', '#D6472E', '#C07508', '#059669', '#2563EB']
const HISTORY_CAP = 20

export default function SketchDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const historyRef = useRef<string[]>([])
  const [title, setTitle] = useState('')
  const [color, setColor] = useState(COLORS[0])
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [canUndo, setCanUndo] = useState(false)
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
    e.currentTarget.setPointerCapture(e.pointerId)
    pushHistory()
    drawingRef.current = true
    lastPoint.current = getPos(e)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const p = getPos(e)
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color
    ctx.lineWidth = tool === 'eraser' ? ERASER_WIDTH : PEN_WIDTH
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(lastPoint.current!.x, lastPoint.current!.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastPoint.current = p
  }

  async function onPointerUp() {
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
