import { randomUUID } from 'node:crypto'
import { open, type FileHandle } from 'node:fs/promises'
import { Readable } from 'node:stream'

// The renderer reads previewed PDFs, videos and audio over preview://media/<token>: each token stands for the one
// file files:preview handed it out for, so the page can't name any other path (it never gets file://).
type Media = { kind: 'pdf' | 'video' | 'audio'; mime: string }
const v = (mime: string): Media => ({ kind: 'video', mime })
const a = (mime: string): Media => ({ kind: 'audio', mime })
export const MEDIA: Record<string, Media> = {
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  mp4: v('video/mp4'), m4v: v('video/mp4'), mov: v('video/quicktime'), webm: v('video/webm'), ogv: v('video/ogg'), mkv: v('video/x-matroska'),
  mp3: a('audio/mpeg'), m4a: a('audio/mp4'), aac: a('audio/aac'), wav: a('audio/wav'), flac: a('audio/flac'), ogg: a('audio/ogg'), opus: a('audio/ogg'), oga: a('audio/ogg')
}

export const mediaOf = (name: string): Media | undefined => {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? undefined : MEDIA[name.slice(dot + 1).toLowerCase()]
}

const PREFIX = 'preview://media/'
export class MediaTokens {
  // one token per path, so a refreshed listing keeps the same src (a playing video doesn't restart)
  // shortcut: the 256 most recently previewed paths; a preview left open past 256 others stops loading new pieces
  private map = new Map<string, string>() // token → path
  private byPath = new Map<string, string>() // path → token, oldest first
  add(path: string): string {
    const token = this.byPath.get(path) ?? randomUUID()
    this.byPath.delete(path)
    this.byPath.set(path, token)
    this.map.set(token, path)
    if (this.byPath.size > 256) {
      const [oldPath, oldToken] = this.byPath.entries().next().value!
      this.byPath.delete(oldPath), this.map.delete(oldToken)
    }
    return PREFIX + token
  }
  path(url: string): string | null {
    if (!url.startsWith(PREFIX)) return null
    return this.map.get(url.slice(PREFIX.length).split(/[?#]/)[0]) ?? null
  }
}

// one `bytes=` range, end inclusive; null without a header (the whole file), 'invalid' when it can't be served
export function parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null {
  if (header === null) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (!m[1] && !m[2])) return 'invalid'
  let start: number, end: number
  if (!m[1]) {
    const n = Number(m[2]) // the last n bytes
    if (!n) return 'invalid'
    ;(start = Math.max(0, size - n)), (end = size - 1)
  } else {
    start = Number(m[1])
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
  }
  return start >= size || start > end ? 'invalid' : { start, end }
}

// the page's origin: app://cassetto, or the dev server on localhost; nobody else reads previews
const appOrigin = (o: string | null) => (o && (o === 'app://cassetto' || /^http:\/\/localhost:\d+$/.test(o)) ? o : null)

export async function serveMedia(tokens: MediaTokens, req: Request): Promise<Response> {
  const origin = appOrigin(req.headers.get('Origin')) // pdf.js fetches cross-origin; <video> and <audio> send none
  const cors: Record<string, string> = origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, ETag', Vary: 'Origin' } : {}
  const path = tokens.path(req.url)
  // opened before answering: an unreadable file is a 403 now, not a broken body after a 200
  let fh: FileHandle
  try {
    if (!path) throw Object.assign(new Error(), { code: 'ENOENT' })
    fh = await open(path)
  } catch (e) {
    const denied = (e as NodeJS.ErrnoException).code === 'EACCES' || (e as NodeJS.ErrnoException).code === 'EPERM'
    return new Response(denied ? 'Accesso negato' : 'Non trovato', { status: denied ? 403 : 404, headers: cors })
  }
  const st = await fh.stat().catch(() => null)
  if (!st?.isFile()) return await fh.close(), new Response('Non trovato', { status: 404, headers: cors })
  const size = st.size
  const range = parseRange(req.headers.get('Range'), size)
  if (range === 'invalid') return await fh.close(), new Response(null, { status: 416, headers: { ...cors, 'Content-Range': `bytes */${size}` } })
  const { start, end } = range ?? { start: 0, end: size - 1 }
  // the ETag tells pdf.js's pieces apart from a file replaced by another of the same size
  const headers: Record<string, string> = { ...cors, 'Accept-Ranges': 'bytes', ETag: `"${size}-${Math.round(st.mtimeMs)}"`, 'Content-Type': mediaOf(path!)?.mime ?? 'application/octet-stream', 'Content-Length': String(end - start + 1) }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  if (!size) await fh.close() // createReadStream with end -1 would read all
  const body = size ? (Readable.toWeb(fh.createReadStream({ start, end })) as ReadableStream) : null // closes the file when done or cancelled
  return new Response(body, { status: range ? 206 : 200, headers })
}
