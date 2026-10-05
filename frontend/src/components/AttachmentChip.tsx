import { useEffect, useState } from 'react'
import { db, type NoteAttachment } from '../db/db'
import { formatBytes, uploadProgress, onUploadChange } from '../lib/files'
import { useLang } from '../lib/i18n'
import FileViewer from './FileViewer'

/** One attachment pill: tap to open it in the in-app viewer (which also
    has Download), × to remove. */
export default function AttachmentChip({ a, onRemove }: { a: NoteAttachment; onRemove: () => void }) {
  const { t } = useLang()
  const [viewing, setViewing] = useState(false)
  // Added on this device and not on the server yet: say so — other devices
  // only get the file once it's uploaded.
  const [upload, setUpload] = useState<number | 'waiting' | null>(null)
  useEffect(() => {
    if (!a.stored) return
    let alive = true
    const read = () => {
      db.files.get(a.id).then((f) => {
        if (alive) setUpload(f?.pending ? (uploadProgress(a.id) ?? 'waiting') : null)
      }).catch(() => {})
    }
    read()
    const off = onUploadChange(read)
    return () => { alive = false; off() }
  }, [a.id, a.stored])
  return (
    <div className="sketch-attachment-chip" title={upload !== null ? `${a.name} — ${t('att.keepOpen')}` : a.name}>
      <button type="button" className="sketch-attachment-link" onClick={() => setViewing(true)}>
        <span className="sketch-attachment-icon">{a.type.startsWith('image/') ? '🖼️' : '📎'}</span>
        <span className="sketch-attachment-name">{a.name}</span>
        {a.size ? <span className="sketch-attachment-size">{formatBytes(a.size)}</span> : null}
        {upload !== null && (
          <span className="sketch-attachment-up">
            {upload === 'waiting' ? t('att.waiting') : upload > 0 ? t('att.uploadingPct', { pct: Math.round(upload * 100) }) : t('att.uploading')}
          </span>
        )}
      </button>
      <button type="button" className="sketch-attachment-remove" onClick={onRemove} aria-label={t('sketch.removeAttachment')}>×</button>
      {viewing && <FileViewer a={a} onClose={() => setViewing(false)} />}
    </div>
  )
}
