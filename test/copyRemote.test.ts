import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { copyRemote, spawnRunner, type Runner } from '../src/main/copyRemote'
import type { Progress } from '../src/main/jobs'
import type { JobItem } from '../src/shared/jobs'

const dir = () => mkdtempSync(join(tmpdir(), 'tcopyr-'))
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
// the "host" is the local sh, in its own process group as a remote session is; `fake` puts a slow command first on PATH
const runner = (fake?: { name: string; body: string }) => {
  const env = { ...process.env }
  if (fake) {
    const bin = dir()
    writeFileSync(join(bin, fake.name), `#!/bin/sh\n${fake.body}\n`)
    chmodSync(join(bin, fake.name), 0o755)
    env.PATH = `${bin}:${env.PATH}`
  }
  const scripts: string[] = []
  const run = spawnRunner('/bin/sh', s => ['-c', s], { detached: true, env })
  const r: Runner = (s, signal) => (scripts.push(s), run(s, signal))
  return { run: r, scripts }
}
const go = (op: 'copy' | 'move', items: JobItem[], p: Progress, run: Runner, signal = new AbortController().signal) => copyRemote({ op, from: 'h', to: 'h', items }, p, signal, run)
const until = async (f: () => boolean) => {
  for (let i = 0; i < 200 && !f(); i++) await new Promise(r => setTimeout(r, 25))
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('copyRemote', () => {
  test('copies item by item, counting at least every byte', async () => {
    const d = dir()
    mkdirSync(join(d, 'tree'))
    writeFileSync(join(d, 'tree', 'f'), Buffer.alloc(10_000, 1))
    writeFileSync(join(d, 'g'), 'hello')
    const items = [
      { src: join(d, 'tree'), dest: join(d, 'tree2'), replace: false },
      { src: join(d, 'g'), dest: join(d, 'g2'), replace: false }
    ]
    const { r, p } = progress()
    const res = await go('copy', items, p, runner().run)
    expect(res.done).toEqual(items)
    expect(r.failed).toEqual([])
    expect(r.items).toEqual(['tree', 'g'])
    expect(r.total).toBeGreaterThanOrEqual(10_005)
    expect(r.added).toBe(r.total)
    expect(readFileSync(join(d, 'tree2', 'f')).length).toBe(10_000)
    expect(readFileSync(join(d, 'g2'), 'utf8')).toBe('hello')
  })

  test('an existing destination fails its item and stays untouched', async () => {
    const d = dir()
    writeFileSync(join(d, 'a'), 'new')
    writeFileSync(join(d, 'b'), 'old')
    writeFileSync(join(d, 'c'), 'c')
    const { r, p } = progress()
    const res = await go('copy', [{ src: join(d, 'a'), dest: join(d, 'b'), replace: false }, { src: join(d, 'c'), dest: join(d, 'c2'), replace: false }], p, runner().run)
    expect(r.failed).toEqual([{ path: join(d, 'a'), error: 'Esiste già' }])
    expect(readFileSync(join(d, 'b'), 'utf8')).toBe('old')
    expect(res.done.map(i => i.src)).toEqual([join(d, 'c')])
  })

  test('a failed copy removes its partial destination', async () => {
    const d = dir()
    mkdirSync(join(d, 'tree'))
    writeFileSync(join(d, 'tree', 'a'), 'a')
    writeFileSync(join(d, 'tree', 'secret'), 's')
    chmodSync(join(d, 'tree', 'secret'), 0)
    const { r, p } = progress()
    const res = await go('copy', [{ src: join(d, 'tree'), dest: join(d, 'tree2'), replace: false }], p, runner().run)
    expect(res.done).toEqual([])
    expect(r.failed.map(f => f.path)).toEqual([join(d, 'tree')])
    expect(existsSync(join(d, 'tree2'))).toBe(false)
  })

  test('cancel kills the running copy and removes its partial destination', async () => {
    const d = dir()
    writeFileSync(join(d, 'a'), 'data')
    const pidFile = join(d, 'pid')
    const { run, scripts } = runner({ name: 'cp', body: `echo partial > "$4"; echo $$ > ${pidFile}; exec sleep 30` })
    const ctrl = new AbortController()
    const { p } = progress()
    const job = go('copy', [{ src: join(d, 'a'), dest: join(d, 'a2'), replace: false }], p, run, ctrl.signal)
    await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').endsWith('\n'))
    const t0 = Date.now()
    ctrl.abort()
    const e = await job.catch(e => e)
    expect(e.name).toBe('AbortError')
    expect(e.done).toEqual([])
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(existsSync(join(d, 'a2'))).toBe(false)
    expect(scripts.some(s => s.startsWith('kill -TERM -'))).toBe(true)
    const pid = Number(readFileSync(pidFile, 'utf8'))
    await until(() => !alive(pid))
    expect(alive(pid)).toBe(false)
  })

  test('cancel of a move never removes its destination', async () => {
    const d = dir()
    writeFileSync(join(d, 'a'), 'data')
    const { run } = runner({ name: 'mv', body: `echo partial > "$3"; exec sleep 30` })
    const ctrl = new AbortController()
    const { p } = progress()
    const job = go('move', [{ src: join(d, 'a'), dest: join(d, 'a2'), replace: false }], p, run, ctrl.signal)
    await until(() => existsSync(join(d, 'a2')))
    ctrl.abort()
    expect((await job.catch(e => e)).name).toBe('AbortError')
    expect(readFileSync(join(d, 'a2'), 'utf8')).toBe('partial\n')
    expect(readFileSync(join(d, 'a'), 'utf8')).toBe('data')
  })
})
