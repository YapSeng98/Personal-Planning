// One-pass cleanup of oversized images saved before images were shrunk on
// the way in (Sketches notes embedded them at full resolution). A note with
// a few full-size screenshots grows past what the server accepts in one
// write, and the sync engine then refuses to send it. Runs at startup;
// cheap when nothing is big (it only measures string lengths).
import { db, writeAndQueue, type NoteAttachment } from '../db/db'
import { shrinkDataUrl } from './attach'

const BIG = 400 * 1024 // only touch images whose data URL is larger than this
// JPEGs this app already shrank (1920px) sit well under this; anything above
// is a full-size original worth re-encoding. Keeps startup from decoding the
// same already-compact images on every launch.
const BIG_JPEG = 1.5 * 1024 * 1024
const worthShrinking = (dataUrl: string) =>
  dataUrl.length > (dataUrl.startsWith('data:image/jpeg') ? BIG_JPEG : BIG)
const IMG_SRC = /src="(data:image\/(?:png|jpeg|webp|bmp);base64,[^"]+)"/g

async function shrinkAttachments(list: NoteAttachment[] | undefined) {
  if (!list?.some((a) => a.type.startsWith('image/') && worthShrinking(a.dataUrl))) return null
  return Promise.all(list.map(async (a) =>
    a.type.startsWith('image/') && worthShrinking(a.dataUrl) ? { ...a, dataUrl: await shrinkDataUrl(a.dataUrl) } : a))
}

export async function compactImages(): Promise<number> {
  let changed = 0
  for (const d of await db.drawings.toArray()) {
    if (d.deleted) continue
    let text = d.text
    if (text && text.length > BIG) {
      for (const [, src] of text.matchAll(IMG_SRC)) {
        if (!worthShrinking(src)) continue
        const small = await shrinkDataUrl(src)
        if (small !== src) text = text.replace(src, small)
      }
    }
    const attachments = await shrinkAttachments(d.attachments)
    if (text !== d.text || attachments) {
      await writeAndQueue(db.drawings, 'drawing', { ...d, text, attachments: attachments ?? d.attachments, updatedAt: Date.now() })
      changed++
    }
  }
  for (const r of await db.reviews.toArray()) {
    if (r.deleted) continue
    const attachments = await shrinkAttachments(r.attachments)
    if (attachments) {
      await writeAndQueue(db.reviews, 'review', { ...r, attachments, updatedAt: Date.now() })
      changed++
    }
  }
  return changed
}
