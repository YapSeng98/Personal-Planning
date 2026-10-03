// pdf.js, loaded only when a PDF is opened (it's ~1.7 MB with its worker).
// Used instead of an <iframe>, which on iPhone shows just the first page.
import type { PDFDocumentProxy } from 'pdfjs-dist'

let lib: Promise<typeof import('pdfjs-dist')> | null = null

function load() {
  lib ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })
  return lib
}

/** Render every page of `blob` as a canvas appended to `container`, one at a
    time (so the first pages show while later ones are still drawing).
    Stops early if `cancelled()` turns true (viewer closed). */
export async function renderPdf(blob: Blob, container: HTMLElement, cancelled: () => boolean): Promise<number> {
  const pdfjs = await load()
  const doc: PDFDocumentProxy = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
  const width = container.clientWidth || 800
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  for (let n = 1; n <= doc.numPages; n++) {
    if (cancelled()) break
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: (width / base.width) * dpr })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    canvas.className = 'fv-pdf-page'
    container.appendChild(canvas)
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
  }
  const pages = doc.numPages
  doc.destroy()
  return pages
}
