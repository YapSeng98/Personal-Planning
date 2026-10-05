import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { NoteAttachment } from '../db/db'
import { downloadAttachment, getFileBlob, formatBytes, NotUploadedError } from '../lib/files'
import { useLang } from '../lib/i18n'
import Icon from './Icon'

type Kind = 'pdf' | 'image' | 'video' | 'audio' | 'text' | 'other'

function kindOf(a: NoteAttachment): Kind {
  const t = a.type
  const ext = a.name.split('.').pop()?.toLowerCase() ?? ''
  if (t === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  // Exact types only — Office files' MIME types contain "xml" too
  // (application/vnd.openxmlformats-…) and must not be read as text.
  if (t.startsWith('text/') || TEXT_TYPES.includes(t) || TEXT_EXTS.includes(ext)) return 'text'
  return 'other'
}

const TEXT_TYPES = ['application/json', 'application/xml', 'application/x-yaml', 'application/yaml']
const TEXT_EXTS = ['txt', 'md', 'csv', 'json', 'log', 'xml', 'yaml', 'yml']
const MAX_TEXT_CHARS = 500_000

/** Full-screen in-app preview of an attachment, with a Download button.
    PDFs render with pdf.js; media and text natively; anything else (Word,
    Excel…) can't be shown in a browser, so it offers the download. */
export default function FileViewer({ a, onClose }: { a: NoteAttachment; onClose: () => void }) {
  const { t } = useLang()
  const kind = kindOf(a)
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  // not on the server yet: keep trying while the viewer is open
  const [waiting, setWaiting] = useState(false)
  const [loading, setLoading] = useState(kind !== 'other')
  const pdfRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (kind === 'other') return
    let cancelled = false
    let objectUrl = ''
    let retry: number | undefined
    const attempt = async () => {
      try {
        const blob = a.stored ? await getFileBlob(a) : await (await fetch(a.dataUrl)).blob()
        if (cancelled) return
        setWaiting(false)
        if (kind === 'pdf') {
          const { renderPdf } = await import('../lib/pdfView')
          if (pdfRef.current) {
            pdfRef.current.innerHTML = ''
            const done = renderPdf(blob, pdfRef.current, () => cancelled)
            // Show the first page as soon as it's there, not after the last.
            const first = new MutationObserver(() => { setLoading(false); first.disconnect() })
            first.observe(pdfRef.current, { childList: true })
            await done
          }
        } else if (kind === 'text') {
          const s = await blob.text()
          setText(s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) + '\n…' : s)
        } else {
          objectUrl = URL.createObjectURL(blob)
          setUrl(objectUrl)
        }
      } catch (e) {
        if (cancelled) return
        if (e instanceof NotUploadedError) {
          setWaiting(true)
          retry = window.setTimeout(attempt, 5000)
        } else {
          setErr(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    attempt()
    return () => {
      cancelled = true
      window.clearTimeout(retry)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [a, kind])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  async function download() {
    try {
      if (a.stored) await downloadAttachment(a)
      else {
        const link = document.createElement('a')
        link.href = a.dataUrl
        link.download = a.name
        link.click()
      }
    } catch (e) {
      if (e instanceof NotUploadedError) setWaiting(true)
      else setErr(e instanceof Error ? e.message : String(e))
    }
  }

  // Portalled to <body>: inside a frosted-glass card (backdrop-filter) a
  // position:fixed overlay would be confined to the card, not the screen.
  return createPortal(
    <div className="fv-backdrop" role="dialog" aria-label={a.name} onClick={onClose}>
      <div className="fv" onClick={(e) => e.stopPropagation()}>
        <div className="fv-head">
          <span className="fv-name" title={a.name}>{a.name}</span>
          {a.size ? <span className="fv-size">{formatBytes(a.size)}</span> : null}
          <button type="button" className="btn fv-dl" onClick={download}>{t('fv.download')}</button>
          <button type="button" className="fv-close" onClick={onClose} aria-label={t('common.close')}><Icon name="close" size={18} /></button>
        </div>
        <div className={`fv-body fv-k-${kind}`}>
          {loading && <div className="fv-msg">{t('fv.loading')}</div>}
          {err && <div className="fv-msg err">{err}</div>}
          {waiting && <div className="fv-msg fv-waiting">{t('fv.notUploaded')}</div>}
          {kind === 'pdf' && <div ref={pdfRef} className="fv-pdf" />}
          {kind === 'image' && url && <img src={url} alt={a.name} />}
          {kind === 'video' && url && <video src={url} controls playsInline autoPlay />}
          {kind === 'audio' && url && <audio src={url} controls autoPlay />}
          {kind === 'text' && !loading && !err && <pre className="fv-text">{text}</pre>}
          {kind === 'other' && (
            <div className="fv-msg">
              <p>{t('fv.noPreview')}</p>
              <button type="button" className="btn btn-primary" onClick={download}>{t('fv.download')}</button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
