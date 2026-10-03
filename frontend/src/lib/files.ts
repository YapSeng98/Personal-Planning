// Attachment files kept in Supabase Storage (bucket "attachments", object
// "<user id>/<attachment id>") instead of inline in the record, so they can
// be far bigger than a synced row allows. Offline-first like everything
// else: a new file is written to the local `files` table at once and
// uploaded by the next sync; another device downloads it the first time
// it's opened and keeps the copy.
import { db, uuid, type NoteAttachment } from '../db/db'
import { supabase } from '../sync/supabase'
import { isAuthed } from '../sync/api'

const BUCKET = 'attachments'
/** Supabase free plan's per-file ceiling (bucket limit in schema.sql). */
export const MAX_STORED_BYTES = 50 * 1024 * 1024

async function userId(): Promise<string | null> {
  if (!isAuthed()) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/** Keep a file locally and describe it as a stored attachment. */
export async function storeFile(file: File): Promise<NoteAttachment> {
  const id = uuid()
  await db.files.put({ id, blob: file, pending: 1 })
  return { id, name: file.name, type: file.type, size: file.size, stored: 1, dataUrl: '' }
}

/** Upload every file still waiting (called at the start of each sync).
    Returns how many failed, with the first error, for the sync status. */
export async function uploadPendingFiles(): Promise<string | null> {
  const pending = await db.files.where('pending').equals(1).toArray()
  if (!pending.length) return null
  const uid = await userId()
  if (!uid) return null
  let firstErr: string | null = null
  for (const f of pending) {
    const { error } = await supabase.storage.from(BUCKET).upload(`${uid}/${f.id}`, f.blob, {
      upsert: true,
      contentType: f.blob.type || 'application/octet-stream',
    })
    if (error) firstErr ??= error.message
    else await db.files.update(f.id, { pending: 0 })
  }
  return firstErr
}

/** The file's bytes: the local copy, else downloaded (and cached). */
export async function getFileBlob(a: NoteAttachment): Promise<Blob> {
  const local = await db.files.get(a.id)
  if (local) return local.blob
  const uid = await userId()
  if (!uid) throw new Error('Sign in to download this file')
  const { data, error } = await supabase.storage.from(BUCKET).download(`${uid}/${a.id}`)
  if (error || !data) throw new Error("This file isn't available yet — it may still be uploading from another device")
  const blob = data.type ? data : new Blob([data], { type: a.type })
  await db.files.put({ id: a.id, blob, pending: 0 })
  return blob
}

/** Save the file to the device (what a chip tap does). */
export async function downloadAttachment(a: NoteAttachment) {
  const blob = await getFileBlob(a)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = a.name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** Drop the local copy and (best effort) the uploaded object. */
export async function deleteStoredFiles(list: NoteAttachment[] | undefined) {
  const stored = (list ?? []).filter((a) => a.stored)
  if (!stored.length) return
  await db.files.bulkDelete(stored.map((a) => a.id))
  const uid = await userId()
  if (uid) await supabase.storage.from(BUCKET).remove(stored.map((a) => `${uid}/${a.id}`)).catch(() => {})
}

export function formatBytes(n?: number): string {
  if (!n) return ''
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`
}
