import { afterEach, expect, test, vi } from 'vitest'
import { fetchRange, pdfErrorText } from '../src/renderer/pdfLoad'

const reply = (bytes: number, etag = '"1"', total = 1000) =>
  new Response(new Uint8Array(bytes), { status: 206, headers: { 'Content-Range': `bytes 0-${bytes - 1}/${total}`, ETag: etag } })
afterEach(() => vi.unstubAllGlobals())

test('fetchRange: asks for [begin, end) and returns the bytes, total and ETag', async () => {
  const f = vi.fn(async (_url: string, _init?: RequestInit) => reply(10))
  vi.stubGlobal('fetch', f)
  expect(await fetchRange('preview://media/t', 0, 10)).toEqual({ data: new Uint8Array(10), total: 1000, etag: '"1"' })
  expect(f.mock.calls[0][1]).toMatchObject({ headers: { Range: 'bytes=0-9' } })
})

test('fetchRange: a short answer or another ETag means the file changed', async () => {
  vi.stubGlobal('fetch', async () => reply(5))
  await expect(fetchRange('preview://media/t', 0, 10)).rejects.toThrow('il file è cambiato')
  vi.stubGlobal('fetch', async () => reply(10, '"2"'))
  await expect(fetchRange('preview://media/t', 0, 10, { etag: '"1"' })).rejects.toThrow('il file è cambiato')
  vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }))
  await expect(fetchRange('preview://media/t', 0, 10)).rejects.toThrow('HTTP 404')
})

test('fetchRange: passes the abort signal on', async () => {
  const f = vi.fn(async (_url: string, _init?: RequestInit) => reply(10))
  vi.stubGlobal('fetch', f)
  const ac = new AbortController()
  await fetchRange('preview://media/t', 0, 10, { signal: ac.signal })
  expect(f.mock.calls[0][1]).toMatchObject({ signal: ac.signal })
})

test('pdfErrorText: a password says so, anything else is unreadable', () => {
  expect(pdfErrorText(Object.assign(new Error('No password given'), { name: 'PasswordException' }))).toBe('PDF protetto da password')
  expect(pdfErrorText(new Error('Invalid PDF structure.'))).toBe('PDF non leggibile: Invalid PDF structure.')
})
