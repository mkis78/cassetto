import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport, type PDFDocumentLoadingTask, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { t } from '../shared/i18n'
import { fetchRange, pdfErrorText } from './pdfLoad'

GlobalWorkerOptions.workerSrc = workerUrl

const CHUNK = 65536
// copied there from pdfjs-dist by postinstall: wasm for JPEG2000/JBIG2 images (scanned PDFs) and ICC colours,
// the 14 standard fonts for PDFs that don't embed them, and the CMaps for Chinese, Japanese and Korean text
const pdfjsDir = (sub: string) => new URL(`pdfjs/${sub}`, document.baseURI).href
const resources = { wasmUrl: pdfjsDir(''), standardFontDataUrl: pdfjsDir('standard_fonts/'), cMapUrl: pdfjsDir('cmaps/'), cMapPacked: true }

// the whole file when it fits in the first piece, else a transport pdf.js asks for further pieces
async function openRanged(src: string, signal: AbortSignal, fail: (e: unknown) => void): Promise<{ data: Uint8Array } | { range: PDFDataRangeTransport }> {
  const first = await fetchRange(src, 0, CHUNK, { signal })
  if (first.total <= first.data.length) return { data: first.data }
  const range = new PDFDataRangeTransport(first.total, first.data)
  range.requestDataRange = (begin: number, end: number) =>
    void fetchRange(src, begin, end, { etag: first.etag, signal }).then(c => !signal.aborted && range.onDataRange(begin, c.data), fail)
  return { range }
}

// A PDF as a column of pages, panel-wide, each drawn when it scrolls into view. No zoom or search: it is a preview.
export default function PdfPreview({ src }: { src: string }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [ratio, setRatio] = useState(1.414) // height / width of page 1, for the placeholders
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDoc(null), setError(null)
    let task: PDFDocumentLoadingTask | null = null
    let gone = false
    const ac = new AbortController() // stops pieces still on their way, here and in main
    const fail = (e: unknown) => !gone && setError(pdfErrorText(e as Error))
    openRanged(src, ac.signal, fail)
      .then(async source => {
        if (gone) return
        task = getDocument({ ...source, disableAutoFetch: true, ...resources })
        const d = await task.promise
        const v = (await d.getPage(1)).getViewport({ scale: 1 })
        if (!gone) setRatio(v.height / v.width), setDoc(d)
      })
      .catch(fail)
    return () => void ((gone = true), ac.abort(), task?.destroy())
  }, [src])
  if (error) return <pre className="files-preview-error">{error}</pre>
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
    let cancel: (() => void) | null = null // set while the page is drawn or being drawn
    // only pages near the view hold a bitmap: a Retina page is several MB, a long PDF read through would fill memory
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) {
        if (cancel) cancel(), (cancel = null), (canvas.width = canvas.height = 0) // freed; the CSS aspect ratio keeps its place
        return
      }
      if (cancel) return
      let stopped = false
      const stop = (cancel = () => void (stopped = true))
      const page = await doc.getPage(n).catch(() => null)
      if (!page || stopped) return
      const scale = (canvas.clientWidth * devicePixelRatio) / page.getViewport({ scale: 1 }).width
      const viewport = page.getViewport({ scale })
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`
      const task = page.render({ canvas, viewport })
      if (cancel === stop) cancel = () => task.cancel()
      task.promise.catch(() => {}) // cancelled when it scrolls away or the file changes; a broken page stays blank
    }, { rootMargin: '200px' })
    io.observe(canvas)
    return () => (io.disconnect(), cancel?.())
  }, [doc, n])
  return <canvas ref={ref} className="pdf-page" style={{ aspectRatio: `1 / ${ratio}` }} />
}
