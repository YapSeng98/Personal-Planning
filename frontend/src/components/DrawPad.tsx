import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLang } from '../lib/i18n'
import Icon from './Icon'

const COLORS = ['#1B1B1F', '#D6472E', '#C07508', '#059669', '#2563EB']
const WIDTHS = { pen: 4, eraser: 26 }

/** A drawing pad that pops over a typed note: draw, then Insert drops the
    drawing into the note as an image (cropped to what was drawn). Same
    input rules as full drawing notes: once a real pen (Apple Pencil) is
    seen, finger/palm touches are ignored. */
export default function DrawPad({ onInsert, onClose }: { onInsert: (dataUrl: string, cssWidth: number) => void; onClose: () => void }) {
  const { t } = useLang()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [color, setColor] = useState(COLORS[0])
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const history = useRef<ImageData[]>([])
  const future = useRef<ImageData[]>([])
  const active = useRef<number | null>(null)
  const last = useRef<{ x: number; y: number } | null>(null)
  const penSeen = useRef(false)
  const drew = useRef(false)

  // Size the canvas to its box at device resolution, white background.
  useEffect(() => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    c.width = Math.round(r.width * dpr)
    c.height = Math.round(r.height * dpr)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerType === 'pen') penSeen.current = true
    if (e.pointerType === 'touch' && penSeen.current) return // resting palm
    if (active.current !== null) return
    active.current = e.pointerId
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not capture-eligible */ }
    const c = canvasRef.current!
    history.current.push(c.getContext('2d')!.getImageData(0, 0, c.width, c.height))
    if (history.current.length > 30) history.current.shift()
    setCanUndo(true)
    future.current = []
    setCanRedo(false)
    last.current = pos(e)
    // A tap with no movement still leaves a dot.
    move(e, true)
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>, dot = false) {
    if (e.pointerId !== active.current || !last.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const p = pos(e)
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color
    ctx.lineWidth = WIDTHS[tool] * dpr
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(last.current.x, last.current.y)
    ctx.lineTo(p.x + (dot ? 0.01 : 0), p.y)
    ctx.stroke()
    last.current = p
    if (tool === 'pen') drew.current = true
  }
  function up(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.pointerId !== active.current) return
    active.current = null
    last.current = null
  }

  function undo() {
    const prev = history.current.pop()
    if (!prev) return
    const c = canvasRef.current!, ctx = c.getContext('2d')!
    future.current.push(ctx.getImageData(0, 0, c.width, c.height))
    ctx.putImageData(prev, 0, 0)
    setCanUndo(history.current.length > 0)
    setCanRedo(true)
  }
  function redo() {
    const next = future.current.pop()
    if (!next) return
    const c = canvasRef.current!, ctx = c.getContext('2d')!
    history.current.push(ctx.getImageData(0, 0, c.width, c.height))
    ctx.putImageData(next, 0, 0)
    setCanUndo(true)
    setCanRedo(future.current.length > 0)
  }
  function clear() {
    const c = canvasRef.current!
    const ctx = c.getContext('2d')!
    history.current.push(ctx.getImageData(0, 0, c.width, c.height))
    setCanUndo(true)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
  }

  /** Crop to the drawn area (plus a margin) so the note doesn't get a big
      empty white box, and cap the width so it stays light to sync. */
  function insert() {
    const c = canvasRef.current!
    const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
    let x0 = width, y0 = height, x1 = -1, y1 = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
      }
    }
    if (x1 < 0) return onClose() // nothing drawn
    const pad = 16 * Math.min(window.devicePixelRatio || 1, 2)
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad)
    x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad)
    const w = x1 - x0 + 1, h = y1 - y0 + 1
    const scale = Math.min(1, 1200 / w)
    const out = document.createElement('canvas')
    out.width = Math.round(w * scale)
    out.height = Math.round(h * scale)
    out.getContext('2d')!.drawImage(c, x0, y0, w, h, 0, 0, out.width, out.height)
    // Width in CSS px (what it looked like on the pad), not device pixels.
    onInsert(out.toDataURL('image/png'), w / Math.min(window.devicePixelRatio || 1, 2))
  }

  return createPortal(
    <div className="fv-backdrop" role="dialog" aria-label={t('sketch.drawInNote')}>
      <div className="fv drawpad">
        <div className="fv-head drawpad-head">
          <div className="sketch-colors">
            {COLORS.map((c) => (
              <button key={c} type="button" className={`sketch-swatch ${tool === 'pen' && color === c ? 'on' : ''}`}
                style={{ background: c }} onClick={() => { setTool('pen'); setColor(c) }} aria-label={`${t('sketch.color')}: ${c}`} />
            ))}
          </div>
          <button type="button" className={`sketch-tool-btn ${tool === 'eraser' ? 'on' : ''}`} onClick={() => setTool(tool === 'eraser' ? 'pen' : 'eraser')}>{t('sketch.eraser')}</button>
          <button type="button" className="sketch-tool-btn" onClick={undo} disabled={!canUndo}>{t('sketch.undo')}</button>
          <button type="button" className="sketch-tool-btn" onClick={redo} disabled={!canRedo}>{t('sketch.redo')}</button>
          <button type="button" className="sketch-tool-btn" onClick={clear}>{t('sketch.clear')}</button>
          <button type="button" className="fv-close" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label={t('common.close')}><Icon name="close" size={18} /></button>
        </div>
        <div className="drawpad-body">
          <canvas
            ref={canvasRef}
            className="drawpad-canvas"
            onPointerDown={down}
            onPointerMove={(e) => move(e)}
            onPointerUp={up}
            onPointerCancel={up}
          />
        </div>
        <div className="drawpad-foot">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={insert}>{t('sketch.insertDrawing')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
