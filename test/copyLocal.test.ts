import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, renameSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { copyLocal } from '../src/main/copyLocal'
import type { Progress } from '../src/main/jobs'
import type { JobItem } from '../src/shared/jobs'

// another volume, simulated: rename and link fail with EXDEV while `exdev` is on
let exdev = false
vi.mock('node:fs/promises', async orig => {
  const fs = await orig<typeof import('node:fs/promises')>()
  const cross = <A extends unknown[]>(f: (...a: A) => Promise<void>) => (...a: A) => (exdev ? Promise.reject(Object.assign(new Error('EXDEV'), { code: 'EXDEV' })) : f(...a))
  return { ...fs, rename: cross(fs.rename), link: cross(fs.link) }
})

const dir = () => mkdtempSync(join(tmpdir(), 'tcopy-'))
const BIG = 70 * 1024 * 1024
const bin = dir()
const trash = async (ps: string[]) =>
  ps.map(p => {
    const to = join(bin, basename(p) + Math.random())
    renameSync(p, to)
    return { path: p, trashed: to }
  })
const progress = (onAdd = () => {}) => {
  const r = { total: -1, added: 0, items: [] as (string | null)[], failed: [] as { path: string; error: string }[] }
  const p: Progress = {
    total: n => (r.total = n ?? -1),
    add: b => ((r.added += b), onAdd()),
    item: n => r.items.push(n),
    fail: (path, error) => r.failed.push({ path, error })
  }
  return { r, p }
}
const run = (op: 'copy' | 'move', items: JobItem[], p: Progress, signal = new AbortController().signal) => copyLocal({ op, from: null, to: null, items }, p, signal, trash)

describe('copyLocal', () => {
  test('copies a tree with a big file and a symlink, counting every byte', async () => {
    const d = dir()
    const src = join(d, 'tree')
    mkdirSync(join(src, 'a', 'b'), { recursive: true })
    writeFileSync(join(src, 'a', 'b', 'small.txt'), 'hello')
    writeFileSync(join(src, 'big.bin'), Buffer.alloc(BIG, 7), { mode: 0o640 })
    symlinkSync('../nowhere', join(src, 'a', 'link'))
    const dest = join(d, 'copy')
    const { r, p } = progress()
    const res = await run('copy', [{ src, dest, replace: false }], p)
    expect(res.done).toEqual([{ src, dest, replace: false }])
    expect(r.failed).toEqual([])
    expect(r.items).toEqual(['tree'])
    expect(readFileSync(join(dest, 'a', 'b', 'small.txt'), 'utf8')).toBe('hello')
    expect(readFileSync(join(dest, 'big.bin')).equals(readFileSync(join(src, 'big.bin')))).toBe(true)
    expect(statSync(join(dest, 'big.bin')).mode & 0o777).toBe(0o640)
    expect(readlinkSync(join(dest, 'a', 'link'))).toBe('../nowhere')
    expect(r.total).toBe(BIG + 5)
    expect(r.added).toBe(r.total)
  })

  test('never overwrites', async () => {
    const d = dir()
    writeFileSync(join(d, 'a.txt'), 'new')
    writeFileSync(join(d, 'b.txt'), 'old') // appeared after the conflict check
    const { r, p } = progress()
    for (const op of ['copy', 'move'] as const) {
      const res = await run(op, [{ src: join(d, 'a.txt'), dest: join(d, 'b.txt'), replace: false }], p)
      expect(res.done).toEqual([])
    }
    expect(r.failed).toEqual([
      { path: join(d, 'a.txt'), error: 'Esiste già' },
      { path: join(d, 'a.txt'), error: 'Esiste già' }
    ])
    expect(readFileSync(join(d, 'b.txt'), 'utf8')).toBe('old')
    expect(readFileSync(join(d, 'a.txt'), 'utf8')).toBe('new')
  })

  test('replace sends the existing destination to the Trash first', async () => {
    const d = dir()
    writeFileSync(join(d, 'a.txt'), 'new')
    mkdirSync(join(d, 'b.txt'))
    const { r, p } = progress()
    const res = await run('copy', [{ src: join(d, 'a.txt'), dest: join(d, 'b.txt'), replace: true }], p)
    expect(r.failed).toEqual([])
    expect(readFileSync(join(d, 'b.txt'), 'utf8')).toBe('new')
    expect(res.trashed.map(x => x.path)).toEqual([join(d, 'b.txt')])
    expect(lstatSync(res.trashed[0].trashed!).isDirectory()).toBe(true)
  })

  test('a refused Trash fails that item only', async () => {
    const d = dir()
    writeFileSync(join(d, 'a'), 'A')
    writeFileSync(join(d, 'b'), 'B')
    writeFileSync(join(d, 'old'), 'old')
    const { r, p } = progress()
    const items = [
      { src: join(d, 'a'), dest: join(d, 'old'), replace: true },
      { src: join(d, 'b'), dest: join(d, 'b2'), replace: false }
    ]
    const res = await copyLocal({ op: 'copy', from: null, to: null, items }, p, new AbortController().signal, async ps => ps.map(path => ({ path, error: 'no' })))
    expect(r.failed).toEqual([{ path: join(d, 'a'), error: 'no' }])
    expect(res.done).toEqual([items[1]])
    expect(readFileSync(join(d, 'old'), 'utf8')).toBe('old')
  })

  test('moves on the same volume', async () => {
    const d = dir()
    mkdirSync(join(d, 'src'))
    writeFileSync(join(d, 'src', 'f'), '12345')
    const { r, p } = progress()
    await run('move', [{ src: join(d, 'src'), dest: join(d, 'dst'), replace: false }], p)
    expect(existsSync(join(d, 'src'))).toBe(false)
    expect(readFileSync(join(d, 'dst', 'f'), 'utf8')).toBe('12345')
    expect(r.added).toBe(5)
  })

  test('moves across volumes by copying, then trashing the original', async () => {
    const d = dir()
    mkdirSync(join(d, 'src'))
    writeFileSync(join(d, 'src', 'f'), '12345')
    const { r, p } = progress()
    exdev = true
    try {
      const res = await run('move', [{ src: join(d, 'src'), dest: join(d, 'dst'), replace: false }], p)
      expect(res.trashed.map(x => x.path)).toEqual([join(d, 'src')])
    } finally {
      exdev = false
    }
    expect(r.failed).toEqual([])
    expect(existsSync(join(d, 'src'))).toBe(false)
    expect(readFileSync(join(d, 'dst', 'f'), 'utf8')).toBe('12345')
    expect(r.added).toBe(5)
  })

  test('cancel removes the partial item', async () => {
    const d = dir()
    writeFileSync(join(d, 'first'), 'x')
    mkdirSync(join(d, 'tree'))
    writeFileSync(join(d, 'tree', 'big.bin'), Buffer.alloc(BIG))
    const ctrl = new AbortController()
    const { r, p } = progress(() => r.added > 1 && ctrl.abort()) // the first chunk of the big file
    const items = [
      { src: join(d, 'first'), dest: join(d, 'first2'), replace: false },
      { src: join(d, 'tree'), dest: join(d, 'tree2'), replace: false },
      { src: join(d, 'first'), dest: join(d, 'first3'), replace: false }
    ]
    const e = await run('copy', items, p, ctrl.signal).catch(e => e)
    expect(e.name).toBe('AbortError')
    expect(e.done).toEqual([items[0]])
    expect(existsSync(join(d, 'tree2'))).toBe(false)
    expect(existsSync(join(d, 'first3'))).toBe(false)
    expect(readFileSync(join(d, 'first2'), 'utf8')).toBe('x')
    expect(statSync(join(d, 'tree', 'big.bin')).size).toBe(BIG)
    expect(r.added).toBeLessThan(BIG)
  })
})
