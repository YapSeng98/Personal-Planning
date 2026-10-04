// Slimming records saved before today's size rules: Sketches notes used to
// embed images at full resolution and keep attached files inline, so one
// note could reach tens of MB — far past what a synced row allows (the
// engine refuses records over MAX_RECORD_BYTES). This moves inline files
// to Supabase Storage (lib/files.ts) and re-shrinks oversized images.
// Runs at startup over everything, and from the sync engine on any record
// that's too big to send. Cheap when nothing is big: it only measures
// string lengths until it finds something worth touching.
import { db, patchAndQueue, type DrawingNote, type NoteAttachment, type Review } from '../db/db'
import { shrinkDataUrl } from './attach'

const BIG = 400 * 1024 // only touch images whose data URL is larger than this
// JPEGs this app already shrank (1920px) sit well under this; anything above
// is a full-size original worth re-encoding. Keeps startup from decoding the
// same already-compact images on every launch.
const BIG_JPEG = 1.5 * 1024 * 1024
const worthShrinking = (dataUrl: string) =>
  dataUrl.length > (dataUrl.startsWith('data:image/jpeg') ? BIG_JPEG : BIG)
// Inline attachments bigger than this move to Storage.
const MOVE_OVER = 300 * 1024
const IMG_SRC = /src="(data:image\/[a-z0-9.+-]+;base64,[^"]+)"/gi

async function toStorage(a: NoteAttachment): Promise<NoteAttachment> {
  const blob = await (await fetch(a.dataUrl)).blob()
  await db.files.put({ id: a.id, data: await blob.arrayBuffer(), type: a.type || blob.type, pending: 1 })
  return { ...a, stored: 1, size: blob.size, dataUrl: '' }
}

async function slimAttachments(list: NoteAttachment[] | undefined): Promise<NoteAttachment[] | null> {
  if (!list?.some((a) => !a.stored && a.dataUrl.length > MOVE_OVER)) return null
  const out: NoteAttachment[] = []
  for (let a of list) {
    if (!a.stored && a.dataUrl.length > MOVE_OVER) {
      // Images: shrinking may be enough to stay inline (thumbnails work offline).
      if (a.type.startsWith('image/') && worthShrinking(a.dataUrl)) a = { ...a, dataUrl: await shrinkDataUrl(a.dataUrl) }
      if (a.dataUrl.length > MOVE_OVER) a = await toStorage(a)
    }
    out.push(a)
  }
  return out
}

/** How hard to squeeze when a note is still too big to sync: level 0 is the
    normal pass (only oversized originals); 1 and 2 re-encode every image
    over 200 KB smaller — for notes holding many already-compact photos. */
const LEVELS = [null, { side: 1600, q: 0.8 }, { side: 1280, q: 0.72 }] as const
export const MAX_SLIM_LEVEL = LEVELS.length - 1

/** Images embedded in a note's HTML: shrink the big ones; anything still
    huge afterwards (GIF, etc.) is re-encoded as JPEG regardless. */
async function slimNoteHtml(text: string | undefined, level = 0): Promise<string | undefined> {
  if (!text || text.length <= BIG) return text
  const lv = LEVELS[level]
  let out = text
  for (const [, src] of text.matchAll(IMG_SRC)) {
    let small = src
    if (lv) {
      if (src.length <= 200 * 1024) continue
      small = await shrinkDataUrl(src, true, lv.side, lv.q)
    } else {
      if (!worthShrinking(src)) continue
      small = await shrinkDataUrl(src)
      if (small.length > BIG_JPEG) small = await shrinkDataUrl(small, true)
    }
    if (small !== src) out = out.replace(src, small)
  }
  return out
}

/** A slimmer copy of the record, or null if there was nothing to do. */
export async function slimDrawing(d: DrawingNote, level = 0): Promise<DrawingNote | null> {
  const text = await slimNoteHtml(d.text, level)
  const attachments = await slimAttachments(d.attachments)
  let dataUrl = d.dataUrl
  if (dataUrl && dataUrl.length > 2 * 1024 * 1024) dataUrl = await shrinkDataUrl(dataUrl, true)
  if (text === d.text && !attachments && dataUrl === d.dataUrl) return null
  return { ...d, text, dataUrl, attachments: attachments ?? d.attachments, updatedAt: Date.now() }
}

export async function slimReview(r: Review): Promise<Review | null> {
  const attachments = await slimAttachments(r.attachments)
  return attachments ? { ...r, attachments, updatedAt: Date.now() } : null
}

/** Save a slimmed copy as a patch of just what slimming changed (note
    text/drawing, and the attachments it moved or shrank — replaced by id),
    so it can't undo anything else that changed meanwhile. */
export async function saveSlimmed<T extends DrawingNote | Review>(table: 'drawing' | 'review', before: T, after: T) {
  const prev = new Map((before.attachments ?? []).map((a) => [a.id, JSON.stringify(a)]))
  const changedAtts = (after.attachments ?? []).filter((a) => prev.get(a.id) !== JSON.stringify(a))
  const att = changedAtts.length ? { up: changedAtts } : undefined
  if (table === 'drawing') {
    const d = before as DrawingNote, s = after as DrawingNote
    const patch: Partial<DrawingNote> = {}
    if (s.text !== d.text) patch.text = s.text
    if (s.dataUrl !== d.dataUrl) patch.dataUrl = s.dataUrl
    await patchAndQueue(db.drawings, 'drawing', before.id, patch, att)
  } else {
    await patchAndQueue(db.reviews, 'review', before.id, {}, att)
  }
}

export async function compactImages(): Promise<number> {
  let changed = 0
  for (const d of await db.drawings.toArray()) {
    if (d.deleted) continue
    const slim = await slimDrawing(d)
    if (slim) {
      await saveSlimmed('drawing', d, slim)
      changed++
    }
  }
  for (const r of await db.reviews.toArray()) {
    if (r.deleted) continue
    const slim = await slimReview(r)
    if (slim) {
      await saveSlimmed('review', r, slim)
      changed++
    }
  }
  return changed
}

/** Where a record's bytes are — for the "too large" message. */
export function sizeBreakdown(rec: { text?: string; dataUrl?: string; attachments?: NoteAttachment[] }): string {
  const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`
  const imgs = [...(rec.text ?? '').matchAll(IMG_SRC)].reduce((n, m) => n + m[1].length * 0.75, 0)
  const files = (rec.attachments ?? []).reduce((n, a) => n + a.dataUrl.length * 0.75, 0)
  const parts = []
  if (imgs > 1048576) parts.push(`images in the note ${mb(imgs)}`)
  if (rec.dataUrl && rec.dataUrl.length > 1048576) parts.push(`drawing ${mb(rec.dataUrl.length * 0.75)}`)
  if (files > 1048576) parts.push(`attached files ${mb(files)}`)
  return parts.join(', ')
}
