import { chmodSync, mkdtempSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { MediaTokens, mediaOf, parseRange, serveMedia } from '../src/main/mediaPreview'

test('mediaOf: by extension, any case', () => {
  expect(mediaOf('a.PDF')).toEqual({ kind: 'pdf', mime: 'application/pdf' })
  expect(mediaOf('b.mp4')?.kind).toBe('video')
  expect(mediaOf('c.flac')?.kind).toBe('audio')
  expect(mediaOf('d.txt')).toBeUndefined()
  expect(mediaOf('noext')).toBeUndefined()
})

test('tokens: one stable URL per path, so a refresh or a long-open preview keeps working', () => {
  const tokens = new MediaTokens()
  const url = tokens.add('/x/a.mp4')
  expect(tokens.add('/x/a.mp4')).toBe(url)
  for (let i = 0; i < 255; i++) tokens.add(`/x/${i}.pdf`)
  tokens.add('/x/a.mp4') // used again: now the newest
  tokens.add('/x/new.pdf')
  expect(tokens.path(url)).toBe('/x/a.mp4')
  expect(tokens.path(tokens.add('/x/0.pdf'))).toBe('/x/0.pdf') // evicted, then handed a fresh token
})

test('tokens: only handed-out URLs, last 256 paths kept', () => {
  const tokens = new MediaTokens()
  const url = tokens.add('/x/a.pdf')
  expect(url.startsWith('preview://media/')).toBe(true)
  expect(tokens.path(url)).toBe('/x/a.pdf')
  expect(tokens.path('preview://media/nope')).toBeNull()
  expect(tokens.path(url.replace('//media/', '//other/'))).toBeNull()
  expect(tokens.path('file:///etc/passwd')).toBeNull()
  expect(tokens.path('not a url')).toBeNull()
  for (let i = 0; i < 256; i++) tokens.add(`/x/${i}.mp4`)
  expect(tokens.path(url)).toBeNull()
})

test('parseRange: single ranges, open-ended and suffix, clamped', () => {
  expect(parseRange(null, 1000)).toBeNull()
  expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
  expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
  expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
  expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 })
  for (const h of ['bytes=1000-', 'bytes=5-2', 'bytes=0-1,5-6', 'items=0-1', 'bytes=-0', 'bytes=-']) expect(parseRange(h, 1000)).toBe('invalid')
})

const file = () => {
  const path = join(mkdtempSync(join(tmpdir(), 'media-')), 'a.mp4')
  const data = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256))
  writeFileSync(path, data)
  return { path, data }
}

test('serve: whole file, a range, out of bounds, unknown token', async () => {
  const { path, data } = file()
  const tokens = new MediaTokens()
  const url = tokens.add(path)
  const whole = await serveMedia(tokens, new Request(url))
  expect(whole.status).toBe(200)
  expect(whole.headers.get('Content-Length')).toBe('1000')
  expect(whole.headers.get('Accept-Ranges')).toBe('bytes')
  expect(whole.headers.get('Content-Type')).toBe('video/mp4')
  expect(Buffer.from(await whole.arrayBuffer())).toEqual(data)

  const part = await serveMedia(tokens, new Request(url, { headers: { Range: 'bytes=10-19' } }))
  expect(part.status).toBe(206)
  expect(part.headers.get('Content-Range')).toBe('bytes 10-19/1000')
  expect(Buffer.from(await part.arrayBuffer())).toEqual(data.subarray(10, 20))

  const out = await serveMedia(tokens, new Request(url, { headers: { Range: 'bytes=2000-' } }))
  expect(out.status).toBe(416)
  expect(out.headers.get('Content-Range')).toBe('bytes */1000')

  expect((await serveMedia(tokens, new Request('preview://media/nope'))).status).toBe(404)
})

test('serve: missing file is 404', async () => {
  const { path } = file()
  const tokens = new MediaTokens()
  const url = tokens.add(path)
  unlinkSync(path)
  expect((await serveMedia(tokens, new Request(url))).status).toBe(404)
})

test('serve: an unreadable file is 403 before any byte is promised', async () => {
  const { path } = file()
  const tokens = new MediaTokens()
  const url = tokens.add(path)
  chmodSync(path, 0)
  expect((await serveMedia(tokens, new Request(url))).status).toBe(403)
})

test('serve: an ETag that changes with the file, so a reader notices it was replaced', async () => {
  const { path } = file()
  const tokens = new MediaTokens()
  const url = tokens.add(path)
  const a = (await serveMedia(tokens, new Request(url))).headers.get('ETag')
  utimesSync(path, new Date(), new Date(Date.now() + 5000))
  const b = (await serveMedia(tokens, new Request(url))).headers.get('ETag')
  expect(a).toMatch(/^".+"$/)
  expect(b).not.toBe(a)
})

test('serve: CORS only for the app itself', async () => {
  const { path } = file()
  const tokens = new MediaTokens()
  const url = tokens.add(path)
  const acao = async (origin: string) => (await serveMedia(tokens, new Request(url, { headers: { Origin: origin } }))).headers.get('Access-Control-Allow-Origin')
  expect(await acao('app://cassetto')).toBe('app://cassetto')
  expect(await acao('http://localhost:5173')).toBe('http://localhost:5173')
  expect(await acao('https://evil.example')).toBeNull()
  expect(await acao('http://localhost.evil.example')).toBeNull()
})
