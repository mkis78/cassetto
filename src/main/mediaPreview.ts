import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
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

export async function serveMedia(tokens: MediaTokens, req: Request): Promise<Response> {
  // the page is app://cassetto (http://localhost in dev) and pdf.js fetches cross-origin; the token is the secret
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges' }
  const path = tokens.path(req.url)
  const st = path ? await stat(path).catch(() => null) : null
  if (!path || !st?.isFile()) return new Response('Non trovato', { status: 404, headers: cors })
  const size = st.size
  const range = parseRange(req.headers.get('Range'), size)
  if (range === 'invalid') return new Response(null, { status: 416, headers: { ...cors, 'Content-Range': `bytes */${size}` } })
  const { start, end } = range ?? { start: 0, end: size - 1 }
  const headers: Record<string, string> = { ...cors, 'Accept-Ranges': 'bytes', 'Content-Type': mediaOf(path)?.mime ?? 'application/octet-stream', 'Content-Length': String(end - start + 1) }
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  const body = size ? (Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream) : null // createReadStream with end -1 would read all
  return new Response(body, { status: range ? 206 : 200, headers })
}
