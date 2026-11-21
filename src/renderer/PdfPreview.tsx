import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { t } from '../shared/i18n'

GlobalWorkerOptions.workerSrc = workerUrl

const CHUNK = 65536
const fetchRange = async (src: string, begin: number, end: number) => {
  const r = await fetch(src, { headers: { Range: `bytes=${begin}-${end - 1}` } })
  if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`)
  return { r, data: new Uint8Array(await r.arrayBuffer()) }
}

// pdf.js only reads in pieces over http(s); for preview:// we hand it the pieces ourselves, so a big PDF isn't read whole
async function openRanged(src: string, fail: (e: unknown) => void): Promise<{ data: Uint8Array } | { range: PDFDataRangeTransport }> {
  const { r, data } = await fetchRange(src, 0, CHUNK)
  const total = Number(r.headers.get('Content-Range')?.split('/')[1] ?? data.length)
  if (total <= data.length) return { data }
  const range = new PDFDataRangeTransport(total, data)
  range.requestDataRange = (begin: number, end: number) => void fetchRange(src, begin, end).then(c => range.onDataRange(begin, c.data), fail)
  return { range }
}

// A PDF as a column of pages, panel-wide, each drawn when it scrolls into view. No zoom or search: it is a preview.
// shortcut: no standard_fonts/cmaps shipped, so PDFs that don't embed their fonts use look-alikes; ship them if it shows
export default function PdfPreview({ src }: { src: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [ratio, setRatio] = useState(1.414) // height / width of page 1, for the placeholders
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDoc(null), setError(null)
    let task: PDFDocumentLoadingTask | null = null
    let gone = false
    const fail = (e: unknown) => !gone && setError((e as Error).message)
    openRanged(src, fail)
      .then(async source => {
        if (gone) return
        task = getDocument({ ...source, disableAutoFetch: true })
        const d = await task.promise
        const v = (await d.getPage(1)).getViewport({ scale: 1 })
        if (!gone) setRatio(v.height / v.width), setDoc(d)
      })
      .catch(fail)
    return () => void ((gone = true), task?.destroy())
  }, [src])
  if (error) return <pre className="files-preview-error">{t('PDF non leggibile: {error}', { error })}</pre>
  if (!doc) return <div className="files-empty">{t('Caricamento…')}</div>
  return (
    <div className="pdf-pages">
      {Array.from({ length: doc.numPages }, (_, i) => (
        <PdfPage key={i} doc={doc} n={i + 1} ratio={ratio} />
      ))}
    </div>
  )
}

function PdfPage({ doc, n, ratio }: { doc: PDFDocumentProxy; n: number; ratio: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    let cancel: (() => void) | null = null
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || cancel) return
      io.disconnect()
      let stopped = false
      cancel = () => void (stopped = true)
      const page = await doc.getPage(n).catch(() => null)
      if (!page || stopped) return
      const scale = (canvas.clientWidth * devicePixelRatio) / page.getViewport({ scale: 1 }).width
      const viewport = page.getViewport({ scale })
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`
      const task = page.render({ canvas, viewport })
      cancel = () => task.cancel()
      task.promise.catch(() => {}) // cancelled when the file changes; a broken page stays blank
    }, { rootMargin: '200px' })
    io.observe(canvas)
    return () => (io.disconnect(), cancel?.())
  }, [doc, n])
  return <canvas ref={ref} className="pdf-page" style={{ aspectRatio: `1 / ${ratio}` }} />
}
