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

/** Non-image files above this are rejected — images get shrunk instead. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_SIDE = 1920

/** Screenshots come in as multi-MB PNGs; re-encode as a JPEG capped at
    1920px on the long side, which keeps charts readable at a fraction of
    the size. GIF/SVG (animation/vectors) and anything that fails to decode
    pass through untouched. */
export async function shrinkImage(file: File): Promise<{ dataUrl: string; type: string; name: string }> {
  const passthrough = async () => ({ dataUrl: await readAsDataUrl(file), type: file.type, name: file.name })
  if (!/^image\/(png|jpeg|webp|bmp)$/.test(file.type)) return passthrough()
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    const ctx = canvas.getContext('2d')!
    // JPEG has no alpha — paint transparent areas white instead of black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    // Flat/simple PNGs can come out larger as JPEG — keep the original then.
    if (dataUrl.length * 0.75 >= file.size) return passthrough()
    return { dataUrl, type: 'image/jpeg', name: file.name.replace(/\.\w+$/, '') + '.jpg' }
  } catch {
    return passthrough()
  }
}
