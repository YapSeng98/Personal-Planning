// Turning picked/pasted/dropped files into inline attachments. They're stored
// as data URLs on the record and synced with it, so size matters: every
// change re-sends the whole record.

export function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

const MAX_SIDE = 1920

/** Screenshots come in as multi-MB PNGs; re-encode as a JPEG capped at
    1920px on the long side, which keeps charts readable at a fraction of
    the size. GIF/SVG (animation/vectors) and anything that fails to decode
    pass through untouched — unless `force`, which re-encodes any image the
    browser can decode (a GIF keeps only its first frame), for images too big
    to keep as they are. */
export async function shrinkImage(file: File, force = false, maxSide = MAX_SIDE, quality = 0.85): Promise<{ dataUrl: string; type: string; name: string }> {
  const passthrough = async () => ({ dataUrl: await readAsDataUrl(file), type: file.type, name: file.name })
  if (!(force ? /^image\//.test(file.type) && file.type !== 'image/svg+xml' : /^image\/(png|jpeg|webp|bmp)$/.test(file.type))) return passthrough()
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    const ctx = canvas.getContext('2d')!
    // JPEG has no alpha — paint transparent areas white instead of black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    // Flat/simple PNGs can come out larger as JPEG — keep the original then.
    if (dataUrl.length * 0.75 >= file.size) return passthrough()
    return { dataUrl, type: 'image/jpeg', name: file.name.replace(/\.\w+$/, '') + '.jpg' }
  } catch {
    return passthrough()
  }
}

/** Re-encode a stored image data URL via shrinkImage — for images saved
    before shrinking existed. Returns the original when it isn't smaller. */
export async function shrinkDataUrl(dataUrl: string, force = false, maxSide = MAX_SIDE, quality = 0.85): Promise<string> {
  try {
    const blob = await (await fetch(dataUrl)).blob()
    const out = await shrinkImage(new File([blob], 'img', { type: blob.type }), force, maxSide, quality)
    return out.dataUrl.length < dataUrl.length ? out.dataUrl : dataUrl
  } catch {
    return dataUrl
  }
}
