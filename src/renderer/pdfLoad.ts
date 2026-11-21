import { t } from '../shared/i18n'

// One piece [begin, end) of a previewed PDF over preview://. pdf.js only reads in pieces over http(s), so PdfPreview
// feeds it these itself. A short piece or another ETag than the first one's means the file changed under us.
export async function fetchRange(src: string, begin: number, end: number, opts: { etag?: string | null; signal?: AbortSignal } = {}) {
  const r = await fetch(src, { headers: { Range: `bytes=${begin}-${end - 1}` }, signal: opts.signal })
  if (r.status !== 206 && r.status !== 200) throw new Error(`HTTP ${r.status}`)
  const data = new Uint8Array(await r.arrayBuffer())
  const etag = r.headers.get('ETag')
  const total = Number(r.headers.get('Content-Range')?.split('/')[1] ?? data.length)
  if ((opts.etag !== undefined && etag !== opts.etag) || data.length !== Math.min(end, total) - begin) throw new Error(t('il file è cambiato'))
  return { data, total, etag }
}

export const pdfErrorText = (e: Error): string => (e.name === 'PasswordException' ? t('PDF protetto da password') : t('PDF non leggibile: {error}', { error: e.message }))
