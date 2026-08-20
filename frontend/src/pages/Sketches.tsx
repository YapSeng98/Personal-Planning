import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { db, uuid, notifyChange, CHANGED, type DrawingNote } from '../db/db'
import { useLang } from '../lib/i18n'

export default function Sketches() {
  const navigate = useNavigate()
  const [items, setItems] = useState<DrawingNote[]>([])
  const { t } = useLang()

  const load = useCallback(async () => {
    const all = await db.drawings.toArray()
    all.sort((a, b) => b.updatedAt - a.updatedAt)
    setItems(all)
  }, [])

  useEffect(() => {
    load()
    window.addEventListener(CHANGED, load)
    return () => window.removeEventListener(CHANGED, load)
  }, [load])

  async function remove(d: DrawingNote, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm(t('sketch.deleteConfirm', { title: d.title || t('sketch.untitled') }))) return
    await db.drawings.delete(d.id)
    notifyChange()
  }

  return (
    <div>
      <div className="greet page-head">
        <div>
          <h1>{t('sketch.title')}</h1>
          <div className="sub">{t('sketch.sub')}</div>
        </div>
        <button className="btn btn-primary" onClick={() => navigate(`/sketches/${uuid()}`)}>{t('sketch.new')}</button>
      </div>

      {items.length === 0 ? (
        <div className="card empty-cta">
          <p>{t('sketch.empty')}</p>
        </div>
      ) : (
        <div className="sketch-grid">
          {items.map((d) => (
            <div key={d.id} className="card sketch-card">
              <button type="button" className="sketch-thumb" onClick={() => navigate(`/sketches/${d.id}`)} aria-label={d.title || t('sketch.untitled')}>
                <img src={d.dataUrl} alt="" />
              </button>
              <div className="sketch-meta">
                <button type="button" className="sketch-name" onClick={() => navigate(`/sketches/${d.id}`)}>{d.title || t('sketch.untitled')}</button>
                <button type="button" className="sketch-del" onClick={(e) => remove(d, e)} aria-label={t('common.delete')}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
