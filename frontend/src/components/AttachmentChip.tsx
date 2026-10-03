import { useState } from 'react'
import type { NoteAttachment } from '../db/db'
import { downloadAttachment, formatBytes } from '../lib/files'
import { useLang } from '../lib/i18n'

/** One attachment pill: tap to download, × to remove. Inline (older,
    small) attachments are plain links; stored ones fetch the file first —
    from this device if it has it, else from Supabase Storage. */
export default function AttachmentChip({ a, onRemove }: { a: NoteAttachment; onRemove: () => void }) {
  const { t } = useLang()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function open() {
    setBusy(true)
    setErr('')
    try {
      await downloadAttachment(a)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const label = (
    <>
      <span className="sketch-attachment-icon">{a.type.startsWith('image/') ? '🖼️' : '📎'}</span>
      <span className="sketch-attachment-name">{a.name}</span>
      {a.size ? <span className="sketch-attachment-size">{busy ? '…' : formatBytes(a.size)}</span> : null}
    </>
  )
  return (
    <div className="sketch-attachment-chip" title={err || a.name}>
      {a.stored ? (
        <button type="button" className="sketch-attachment-link" onClick={open} disabled={busy}>{label}</button>
      ) : (
        <a className="sketch-attachment-link" href={a.dataUrl} download={a.name} target="_blank" rel="noopener noreferrer">{label}</a>
      )}
      {err && <span className="sketch-attachment-err" role="alert">!</span>}
      <button type="button" className="sketch-attachment-remove" onClick={onRemove} aria-label={t('sketch.removeAttachment')}>×</button>
    </div>
  )
}
