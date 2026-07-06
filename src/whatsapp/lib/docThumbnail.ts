// Client-side document thumbnail generation.
//
// Produces a small JPEG thumbnail (page 1 / embedded thumbnail) from a document
// Blob, entirely in the browser — no server CPU. Used by the chat thread to
// render a document preview ONCE, then cache it in R2 so every agent reuses it
// (see DocThumb + media-upload's `doc_preview` branch).
//
// Returns null when the type can't be thumbnailed cheaply (e.g. a .docx with no
// embedded thumbnail, or a legacy binary .doc). Callers fall back to the icon.

const THUMB_WIDTH = 600

function isOoxml(mime: string, ext: string): boolean {
  return (
    ext === 'docx' || ext === 'pptx' || ext === 'xlsx' || ext === 'ppsx' || ext === 'xlsm' || ext === 'docm'
    || mime.includes('officedocument')
  )
}

export function isThumbnailable(mime: string, name: string): boolean {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  return mime === 'application/pdf' || ext === 'pdf' || isOoxml(mime, ext)
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82))
}

async function pdfThumbnail(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob)
  try {
    const pdfjs = await import('pdfjs-dist')
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url' as string) as { default: string }).default
    ;(pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = workerUrl
    const task = (pdfjs as unknown as { getDocument: (s: string) => { promise: Promise<unknown> } }).getDocument(url)
    const doc = await task.promise as {
      getPage: (n: number) => Promise<{
        getViewport: (o: { scale: number }) => { width: number; height: number }
        render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> }
      }>
    }
    const page = await doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // White matte so transparent PDFs don't go black when flattened to JPEG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx, viewport }).promise
    return await canvasToJpeg(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function ooxmlThumbnail(blob: Blob): Promise<Blob | null> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(blob)
  const entry = zip.file(/docProps\/thumbnail\.(jpe?g|png)$/i)[0]
  if (!entry) return null
  const raw = await entry.async('blob')
  // Re-encode through a canvas to normalize to JPEG (+ white matte for PNGs).
  const bmp = await createImageBitmap(raw)
  try {
    const scale = Math.min(1, THUMB_WIDTH / bmp.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bmp.width * scale))
    canvas.height = Math.max(1, Math.round(bmp.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return await canvasToJpeg(canvas)
  } finally {
    bmp.close()
  }
}

/**
 * Generate a JPEG thumbnail for a document Blob, or null if not thumbnailable.
 */
export async function generateDocThumbnail(blob: Blob, mime: string, name: string): Promise<Blob | null> {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  try {
    if (mime === 'application/pdf' || ext === 'pdf') return await pdfThumbnail(blob)
    if (isOoxml(mime, ext)) return await ooxmlThumbnail(blob)
    return null
  } catch {
    return null
  }
}
