import { useState } from 'react'
import type { NoteAttachment } from '../db/db'
import { formatBytes } from '../lib/files'
import { useLang } from '../lib/i18n'
import FileViewer from './FileViewer'

/** One attachment pill: tap to open it in the in-app viewer (which also
    has Download), × to remove. */
export default function AttachmentChip({ a, onRemove }: { a: NoteAttachment; onRemove: () => void }) {
  const { t } = useLang()
  const [viewing, setViewing] = useState(false)
  return (
    <div className="sketch-attachment-chip" title={a.name}>
      <button type="button" className="sketch-attachment-link" onClick={() => setViewing(true)}>
        <span className="sketch-attachment-icon">{a.type.startsWith('image/') ? '🖼️' : '📎'}</span>
        <span className="sketch-attachment-name">{a.name}</span>
        {a.size ? <span className="sketch-attachment-size">{formatBytes(a.size)}</span> : null}
      </button>
      <button type="button" className="sketch-attachment-remove" onClick={onRemove} aria-label={t('sketch.removeAttachment')}>×</button>
      {viewing && <FileViewer a={a} onClose={() => setViewing(false)} />}
    </div>
  )
}
