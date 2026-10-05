import { useEffect, useState } from 'react'
import type { NoteAttachment } from '../db/db'
import { getFileBlob, NotUploadedError } from '../lib/files'

/** A picture attachment. Usually its data is inline; a big one can live in
    Storage instead (`stored`, empty dataUrl — lib/compact.ts moves them) and
    is shown from this device's copy, else downloaded (and kept for next
    time). Until it's there — e.g. not uploaded yet from the device that
    added it — a placeholder, retried while it's on screen. */
export default function AttachmentImage({ a, className }: { a: NoteAttachment; className?: string }) {
  const [url, setUrl] = useState(a.stored ? '' : a.dataUrl)

  useEffect(() => {
    if (!a.stored) {
      setUrl(a.dataUrl)
      return
    }
    let alive = true
    let objectUrl = ''
    let retry: number | undefined
    const load = async () => {
      try {
        const blob = await getFileBlob(a)
        if (!alive) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch (e) {
        if (alive && e instanceof NotUploadedError) retry = window.setTimeout(load, 5000)
      }
    }
    setUrl('')
    load()
    return () => {
      alive = false
      window.clearTimeout(retry)
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, a.stored, a.dataUrl])

  if (!url) return <span className={`att-img-wait ${className ?? ''}`} role="img" aria-label={a.name} />
  return <img src={url} alt={a.name} className={className} />
}
