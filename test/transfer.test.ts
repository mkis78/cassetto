import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { transfer } from '../src/main/transfer'
import type { Progress } from '../src/main/jobs'
import type { JobItem, JobSpec } from '../src/shared/jobs'

const dir = () => mkdtempSync(join(tmpdir(), 'txfer-'))
const progress = () => {
  const r = { total: -1 as number | null, added: 0, items: [] as (string | null)[], failed: [] as { path: string; error: string }[] }
  const p: Progress = {
    total: n => (r.total = n),
    add: b => (r.added += b),
    item: n => r.items.push(n),
    fail: (path, error) => r.failed.push({ path, error })
  }
  return { r, p }
}
// both "machines" are the local sh; `fake` puts a `tar` first on PATH for one of them
const sides = (fake?: { host: string | null; body: string }) => {
  const env = { ...process.env }
  if (fake) {
    const bin = dir()
    writeFileSync(join(bin, 'tar'), `#!/bin/sh\n${fake.body}\n`)
    chmodSync(join(bin, 'tar'), 0o755)
    env.PATH = `${bin}:${env.PATH}`
  }
  const trashed: string[] = []
  return {
    trashed,
    sides: {
      spawn: (host: string | null, script: string) => spawn('/bin/sh', ['-c', script], { detached: true, env: fake && fake.host === host ? env : process.env }),
      trash: async (paths: string[]) => paths.map(path => (rmSync(path, { recursive: true }), trashed.push(path), { path }))
    }
  }
}
const parts = (d: string) => readdirSync(d).filter(n => n.startsWith('.cassetto-part-'))
const tree = () => {
  const d = dir()
  mkdirSync(join(d, 'tree', 'sub'), { recursive: true })
  writeFileSync(join(d, 'tree', 'sub', 'f'), Buffer.alloc(10_000, 1))
  writeFileSync(join(d, 'tree', 'g'), 'hello')
  symlinkSync('sub/f', join(d, 'tree', 'link'))
  return d
}
const spec = (op: JobSpec['op'], from: string | null, to: string | null, items: JobItem[]): JobSpec => ({ op, from, to, items })

describe('transfer', () => {
  test('copies a folder with nested files and a symlink to another machine', async () => {
    const s = tree()
    const d = dir()
    const { r, p } = progress()
    await transfer(spec('copy', null, 'b', [{ src: join(s, 'tree'), dest: join(d, 'tree'), replace: false }]), p, new AbortController().signal, sides().sides)
    expect(r.failed).toEqual([])
    expect(r.items).toEqual(['tree'])
    expect(r.total).toBeGreaterThan(0)
    expect(r.added).toBeGreaterThanOrEqual(10_005)
    expect(readFileSync(join(d, 'tree', 'sub', 'f')).length).toBe(10_000)
    expect(readFileSync(join(d, 'tree', 'g'), 'utf8')).toBe('hello')
    expect(readlinkSync(join(d, 'tree', 'link'))).toBe('sub/f')
    expect(existsSync(join(s, 'tree', 'g'))).toBe(true)
    expect(parts(d)).toEqual([])
  })

  test('copies under another name', async () => {
    const s = tree()
    const d = dir()
    const { r, p } = progress()
    await transfer(spec('copy', 'a', null, [{ src: join(s, 'tree', 'g'), dest: join(d, 'g copy'), replace: false }]), p, new AbortController().signal, sides().sides)
    expect(r.failed).toEqual([])
    expect(readdirSync(d)).toEqual(['g copy'])
  })

  test.each([
    ['remote', 'b'],
    ['local', null]
  ])('never overwrites (%s destination)', async (_, to) => {
    const s = tree()
    const d = dir()
    writeFileSync(join(d, 'g'), 'old')
    const { r, p } = progress()
    await transfer(spec('copy', 'a', to, [{ src: join(s, 'tree', 'g'), dest: join(d, 'g'), replace: false }]), p, new AbortController().signal, sides().sides)
    expect(r.failed).toEqual([{ path: join(s, 'tree', 'g'), error: 'Esiste già' }])
    expect(readFileSync(join(d, 'g'), 'utf8')).toBe('old')
    expect(parts(d)).toEqual([])
  })

  test.each([
    ['remote', 'b'],
    ['local', null]
  ])('replace removes the old one (%s destination)', async (_, to) => {
    const s = tree()
    const d = dir()
    mkdirSync(join(d, 'tree'))
    writeFileSync(join(d, 'tree', 'old'), 'old')
    const { r, p } = progress()
    const t = sides()
    await transfer(spec('copy', 'a', to, [{ src: join(s, 'tree'), dest: join(d, 'tree'), replace: true }]), p, new AbortController().signal, t.sides)
    expect(r.failed).toEqual([])
    expect(readdirSync(join(d, 'tree')).sort()).toEqual(['g', 'link', 'sub'])
    expect(t.trashed).toEqual(to ? [] : [join(d, 'tree')])
    expect(parts(d)).toEqual([])
  })

  test.each([
    ['remote', 'a'],
    ['local', null]
  ])('move removes the %s source once placed', async (_, from) => {
    const s = tree()
    const d = dir()
    const { r, p } = progress()
    const t = sides()
    await transfer(spec('move', from, from ? null : 'b', [{ src: join(s, 'tree'), dest: join(d, 'tree'), replace: false }]), p, new AbortController().signal, t.sides)
    expect(r.failed).toEqual([])
    expect(existsSync(join(s, 'tree'))).toBe(false)
    expect(t.trashed).toEqual(from ? [] : [join(s, 'tree')])
    expect(readFileSync(join(d, 'tree', 'g'), 'utf8')).toBe('hello')
  })

  test('failed move keeps the source', async () => {
    const s = tree()
    const d = dir()
    const { r, p } = progress()
    const t = sides({ host: 'b', body: 'cat >/dev/null; echo boom >&2; exit 1' })
    await transfer(spec('move', null, 'b', [{ src: join(s, 'tree'), dest: join(d, 'tree'), replace: false }]), p, new AbortController().signal, t.sides)
    expect(r.failed).toEqual([{ path: join(s, 'tree'), error: 'boom' }])
    expect(readFileSync(join(s, 'tree', 'g'), 'utf8')).toBe('hello')
    expect(t.trashed).toEqual([])
    expect(readdirSync(d)).toEqual([])
  })

  test('a missing source fails its item, the next one goes on', async () => {
    const s = tree()
    const d = dir()
    const { r, p } = progress()
    const items = [
      { src: join(s, 'nope'), dest: join(d, 'nope'), replace: false },
      { src: join(s, 'tree', 'g'), dest: join(d, 'g'), replace: false }
    ]
    await transfer(spec('copy', 'a', 'b', items), p, new AbortController().signal, sides().sides)
    expect(r.failed.map(f => f.path)).toEqual([join(s, 'nope')])
    expect(readdirSync(d)).toEqual(['g'])
  })

  test('cancel kills both sides and removes the part folder', async () => {
    const s = tree()
    const d = dir()
    const { p } = progress()
    const ac = new AbortController()
    const run = transfer(spec('move', 'a', 'b', [{ src: join(s, 'tree'), dest: join(d, 'tree'), replace: false }]), p, ac.signal, sides({ host: 'a', body: 'sleep 30' }).sides)
    for (let i = 0; i < 200 && !parts(d).length; i++) await new Promise(r => setTimeout(r, 25))
    expect(parts(d).length).toBe(1)
    const t0 = Date.now()
    ac.abort()
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(readdirSync(d)).toEqual([])
    expect(readFileSync(join(s, 'tree', 'g'), 'utf8')).toBe('hello')
  })
})
