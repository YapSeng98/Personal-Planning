// Attachment files kept in Supabase Storage (bucket "attachments", object
// "<user id>/<attachment id>") instead of inline in the record, so they can
// be far bigger than a synced row allows. Offline-first like everything
// else: a new file is written to the local `files` table at once and
// uploaded in the background; another device downloads it the first time
// it's opened and keeps the copy. A record only tells other devices about a
// file once the file is uploaded (sync/engine.ts holds the attachment back
// until then), so no device is shown a file it can't open.
import { db, uuid, type LocalFile, type NoteAttachment } from '../db/db'
import { supabase } from '../sync/supabase'
import { isAuthed } from '../sync/api'

const BUCKET = 'attachments'
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string
/** Supabase free plan's per-file ceiling (bucket limit in schema.sql). */
export const MAX_STORED_BYTES = 50 * 1024 * 1024
/** Files above this go up in pieces of exactly this size — what Supabase's
    resumable uploads require. */
const CHUNK = 6 * 1024 * 1024

async function toLocal(id: string, blob: Blob, pending: 0 | 1): Promise<LocalFile> {
  return { id, data: await blob.arrayBuffer(), type: blob.type, pending }
}
function blobOf(f: LocalFile): Blob {
  return f.blob ?? new Blob([f.data ?? new ArrayBuffer(0)], { type: f.type || 'application/octet-stream' })
}

async function session(): Promise<{ uid: string; token: string } | null> {
  if (!isAuthed()) return null
  const { data } = await supabase.auth.getSession()
  const s = data.session
  return s ? { uid: s.user.id, token: s.access_token } : null
}

/** Keep a file locally and describe it as a stored attachment. */
export async function storeFile(file: File): Promise<NoteAttachment> {
  const id = uuid()
  await db.files.put(await toLocal(id, file, 1))
  startUploads()
  return { id, name: file.name, type: file.type, size: file.size, stored: 1, dataUrl: '' }
}

// ---- background uploads

// Progress (0–1) of the files uploading right now, for their chips.
const progress = new Map<string, number>()
const listeners = new Set<() => void>()
function setProgress(id: string, v: number | null) {
  if (v === null) progress.delete(id)
  else progress.set(id, v)
  listeners.forEach((l) => l())
}
export const uploadProgress = (id: string): number | undefined => progress.get(id)
/** Called whenever an upload moves on, finishes or fails. */
export function onUploadChange(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Ids of attachments whose file hasn't reached the server yet. */
export async function notUploadedIds(): Promise<Set<string>> {
  return new Set((await db.files.where('pending').equals(1).primaryKeys()) as string[])
}

let worker: Promise<void> | null = null
let workerGen = 0
let workerSince = 0
let lastError: string | null = null
let afterUpload: () => void = () => {}
/** What to run once a file is uploaded (the sync, so the attachment that
    was held back goes out). */
export function setAfterUpload(fn: () => void) {
  afterUpload = fn
}
/** The latest upload failure, if the last attempt failed (sync status). */
export const lastUploadError = () => lastError

/** Upload waiting files in the background — never inside a sync, so a big
    file on a slow connection doesn't hold up every other change. Safe to
    call any time; one worker runs at once and also takes files added
    while it runs. */
export function startUploads() {
  // A worker stuck on a request the system froze (app suspended mid-upload)
  // must not block uploads forever.
  if (worker && Date.now() - workerSince < 10 * 60_000) return
  workerSince = Date.now()
  const gen = ++workerGen
  worker = (async () => {
    let uploaded = false
    let failed: string | null = null
    try {
      const s = await session()
      if (!s) return
      const tried = new Set<string>()
      for (;;) {
        const next = (await db.files.where('pending').equals(1).toArray()).filter((f) => !tried.has(f.id))
        if (!next.length) break
        for (const f of next) {
          tried.add(f.id)
          try {
            await uploadOne(s, f)
            uploaded = true
          } catch (e) {
            failed ??= e instanceof Error ? e.message : String(e)
          }
        }
      }
      lastError = failed
    } finally {
      if (workerGen === gen) worker = null
      if (uploaded) afterUpload()
    }
  })()
}

async function uploadOne(s: { uid: string; token: string }, f: LocalFile) {
  const blob = blobOf(f)
  setProgress(f.id, 0)
  try {
    if (blob.size > CHUNK) {
      await uploadResumable(s, f, blob)
    } else {
      const { error } = await supabase.storage.from(BUCKET).upload(`${s.uid}/${f.id}`, blob, {
        upsert: true,
        contentType: blob.type || 'application/octet-stream',
      })
      if (error) throw new Error(error.message)
    }
    await db.files.update(f.id, { pending: 0, uploadUrl: undefined })
  } finally {
    setProgress(f.id, null)
  }
}

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

/** A big file goes up in 6 MB pieces (Supabase's resumable "TUS" uploads):
    if it's interrupted — the app sent to the background, a dropped
    connection — the next attempt carries on from the last piece instead of
    starting over. The upload's address is kept with the file for that. */
async function uploadResumable(s: { uid: string; token: string }, f: LocalFile, blob: Blob) {
  const headers = { authorization: `Bearer ${s.token}`, apikey: ANON_KEY, 'tus-resumable': '1.0.0' }
  const resumeAt = async (url: string): Promise<number | null> => {
    const r = await fetch(url, { method: 'HEAD', headers }).catch(() => null)
    return r?.ok ? Number(r.headers.get('upload-offset') ?? 0) : null
  }
  let url = f.uploadUrl
  let offset = url ? await resumeAt(url) : null
  if (offset === null) {
    // new upload (or the old one expired — Supabase keeps them 24 h)
    const meta = [['bucketName', BUCKET], ['objectName', `${s.uid}/${f.id}`],
      ['contentType', blob.type || 'application/octet-stream'], ['cacheControl', '3600']]
      .map(([k, v]) => `${k} ${b64(v)}`).join(',')
    const r = await fetch(`${SUPABASE_URL}/storage/v1/upload/resumable`, {
      method: 'POST',
      headers: { ...headers, 'upload-length': String(blob.size), 'upload-metadata': meta, 'x-upsert': 'true' },
    })
    url = r.headers.get('location') ?? undefined
    if (r.status !== 201 || !url) throw new Error(`upload couldn't start (${r.status})`)
    await db.files.update(f.id, { uploadUrl: url })
    offset = 0
  }
  while (offset < blob.size) {
    setProgress(f.id, offset / blob.size)
    const r = await fetch(url!, {
      method: 'PATCH',
      headers: { ...headers, 'upload-offset': String(offset), 'content-type': 'application/offset+octet-stream' },
      body: blob.slice(offset, offset + CHUNK),
    })
    if (r.status === 409) {
      // the server has a different amount than we thought: ask, carry on
      const at = await resumeAt(url!)
      if (at === null) throw new Error('upload was interrupted')
      offset = at
      continue
    }
    if (r.status !== 204) {
      if (r.status === 404 || r.status === 410) await db.files.update(f.id, { uploadUrl: undefined })
      throw new Error(`upload stopped at ${Math.round(offset / 1048576)} of ${Math.round(blob.size / 1048576)} MB (${r.status})`)
    }
    offset = Number(r.headers.get('upload-offset') ?? offset + CHUNK)
  }
}

// ---- downloads

/** The file isn't on the server yet: the device it was added on hasn't
    finished uploading it (or an older app version sent the note before
    the file). */
export class NotUploadedError extends Error {
  constructor() {
    super('not uploaded yet')
    this.name = 'NotUploadedError'
  }
}

/** The file's bytes: the local copy, else downloaded (and cached). */
export async function getFileBlob(a: NoteAttachment): Promise<Blob> {
  const local = await db.files.get(a.id)
  if (local) return blobOf(local)
  const s = await session()
  if (!s) throw new Error('Sign in to download this file')
  const { data, error } = await supabase.storage.from(BUCKET).download(`${s.uid}/${a.id}`)
  if (error || !data) {
    const e = error as { message?: string; status?: number; statusCode?: string } | null
    const status = e?.status ?? Number(e?.statusCode)
    if (!e || status === 400 || status === 404 || /not.?found/i.test(e.message ?? '')) throw new NotUploadedError()
    throw new Error(`Couldn't download this file: ${e.message ?? status}`)
  }
  const blob = data.type ? data : new Blob([data], { type: a.type })
  // Keeping a copy is a bonus (offline / instant reopen) — if the browser
  // won't store it (private browsing, storage full), still show the file.
  try {
    await db.files.put(await toLocal(a.id, blob, 0))
  } catch {
    // not cached; it downloads again next time
  }
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
  const s = await session()
  if (s) await supabase.storage.from(BUCKET).remove(stored.map((a) => `${s.uid}/${a.id}`)).catch(() => {})
}

export function formatBytes(n?: number): string {
  if (!n) return ''
  return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`
}
