import { sortBy } from '../src/shared/sortEntries'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { MediaTokens } from '../src/main/mediaPreview'
import { previewRemote } from '../src/main/ssh'
import { EDIT_LIMIT, listLocal, previewLimit, previewLocal, readLocal, toPreview, toText, writeLocal } from '../src/main/files'

test('lists folders first, follows symlinks to folders', async () => {
  const d = mkdtempSync(join(tmpdir(), 'tfiles-'))
  mkdirSync(join(d, 'Zeta'))
  writeFileSync(join(d, 'b.txt'), '')
  writeFileSync(join(d, 'A.txt'), '')
  symlinkSync(join(d, 'Zeta'), join(d, 'link'))
  const r = await listLocal(d)
  if (!r.ok) throw new Error(r.error)
  expect(r.listing.path).toBe(d)
  expect(r.listing.entries.map(e => [e.name, e.dir])).toEqual([['link', true], ['Zeta', true], ['A.txt', false], ['b.txt', false]])
  expect(r.listing.entries.find(e => e.name === 'b.txt')).toMatchObject({ size: 0, mtime: expect.any(Number) })
})

test('unreadable folder is an error, not a crash', async () => {
  const d = mkdtempSync(join(tmpdir(), 'tfiles-'))
  const locked = join(d, 'locked')
  mkdirSync(locked)
  chmodSync(locked, 0o000)
  const r = await listLocal(locked)
  chmodSync(locked, 0o755)
  expect(r.ok).toBe(false)
})

test('preview: text, truncated text, binary, image, missing file', async () => {
  expect(toPreview('a.txt', Buffer.from('ciao'))).toEqual({ kind: 'text', text: 'ciao', truncated: false })
  const big = toPreview('a.log', Buffer.alloc(previewLimit('a.log') + 1, 'x'))
  expect(big.kind === 'text' && [big.text.length, big.truncated]).toEqual([previewLimit('a.log'), true])
  expect(toPreview('a.bin', Buffer.from([1, 0, 2]))).toEqual({ kind: 'binary' })
  expect(toPreview('A.PNG', Buffer.from([0x89, 0]))).toEqual({ kind: 'image', src: 'data:image/png;base64,iQA=' })
  expect(toPreview('a.png', Buffer.alloc(previewLimit('a.png') + 1)).kind).toBe('error')
  const d = mkdtempSync(join(tmpdir(), 'tfiles-'))
  writeFileSync(join(d, 'n.md'), '# hi')
  const tokens = new MediaTokens()
  expect(await previewLocal(join(d, 'n.md'), tokens)).toEqual({ kind: 'text', text: '# hi', truncated: false })
  expect((await previewLocal(join(d, 'nope'), tokens)).kind).toBe('error')
})

test('preview: PDF, video and audio go by preview:// locally, a notice on servers', async () => {
  const d = mkdtempSync(join(tmpdir(), 'tfiles-'))
  writeFileSync(join(d, 'a.pdf'), '%PDF')
  const tokens = new MediaTokens()
  const p = await previewLocal(join(d, 'a.pdf'), tokens)
  expect(p.kind).toBe('pdf')
  expect(p.kind === 'pdf' && tokens.path(p.src)).toBe(join(d, 'a.pdf'))
  expect((await previewLocal(join(d, 'x.mp4'), tokens)).kind).toBe('error')
  mkdirSync(join(d, 'dir.mp3'))
  expect((await previewLocal(join(d, 'dir.mp3'), tokens)).kind).toBe('error') // not a regular file
  expect(await previewRemote('host', '/a/b.mov')).toEqual({ kind: 'error', error: 'Anteprima di PDF, video e audio non disponibile sui server' })
})

test('editor: reads text, refuses binary and huge files, writes in place keeping the mode', async () => {
  expect(toText(Buffer.from('è ok'))).toEqual({ ok: true, text: 'è ok' })
  expect(toText(Buffer.from([65, 0, 66]))).toMatchObject({ ok: false, binary: true })
  expect(toText(Buffer.alloc(EDIT_LIMIT + 1, 'a')).ok).toBe(false)
  const d = mkdtempSync(join(tmpdir(), 'tfiles-'))
  const f = join(d, 'run.sh')
  writeFileSync(f, 'echo a\n')
  chmodSync(f, 0o755)
  expect(await readLocal(f)).toEqual({ ok: true, text: 'echo a\n' })
  expect(await writeLocal(f, 'echo b\n')).toEqual({ ok: true })
  expect(readFileSync(f, 'utf8')).toBe('echo b\n')
  expect(statSync(f).mode & 0o777).toBe(0o755)
  expect((await readLocal(join(d, 'nope'))).ok).toBe(false)
  expect((await writeLocal(join(d, 'no/such/dir.txt'), 'x')).ok).toBe(false)
})

test('sort: folders first, then by name, size or date, either way', () => {
  const e = [
    { name: 'b.txt', dir: false, size: 10, mtime: 3 },
    { name: 'Z', dir: true, size: 96, mtime: 1 },
    { name: 'a.txt', dir: false, size: 300, mtime: 2 },
    { name: 'A', dir: true, size: 64, mtime: 5 },
    { name: 'c.txt', dir: false } // remote: no size or date
  ]
  const names = (k: 'name' | 'size' | 'mtime', desc: boolean) => sortBy(e, k, desc).map(x => x.name)
  expect(names('name', false)).toEqual(['A', 'Z', 'a.txt', 'b.txt', 'c.txt'])
  expect(names('name', true)).toEqual(['Z', 'A', 'c.txt', 'b.txt', 'a.txt'])
  expect(names('size', true)).toEqual(['A', 'Z', 'a.txt', 'b.txt', 'c.txt'])
  expect(names('mtime', true)).toEqual(['A', 'Z', 'b.txt', 'a.txt', 'c.txt'])
})
