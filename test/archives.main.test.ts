import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, test, vi } from 'vitest'
import { ArchiveCaches, cacheKey, openLocal, ownedCache, remoteCacheDir, remoteOpenScript } from '../src/main/archives'

const made: string[] = []
const dir = () => (made[made.push(mkdtempSync(join(tmpdir(), 'arch-'))) - 1])
afterAll(() => made.forEach(d => rmSync(d, { recursive: true, force: true })))
const sig = () => new AbortController().signal

// a .tar.gz holding a/b.txt, plus (with links) in -> a/b.txt, q -> ., and the escaping abs -> /etc/passwd, up -> ../../x, x -> q/q/../..
function archive(links = false): string {
  const src = dir()
  mkdirSync(join(src, 'a'))
  writeFileSync(join(src, 'a/b.txt'), 'hello')
  if (links) {
    symlinkSync('a/b.txt', join(src, 'in'))
    symlinkSync('/etc/passwd', join(src, 'abs'))
    symlinkSync('../../x', join(src, 'up'))
    symlinkSync('.', join(src, 'q'))
    symlinkSync('q/q/../..', join(src, 'x'))
  }
  const out = join(dir(), 'x.tar.gz')
  execFileSync('tar', ['-czf', out, '-C', src, ...readdirSync(src)])
  return out
}
const corrupt = () => {
  const f = join(dir(), 'x.tar.gz')
  writeFileSync(f, 'not an archive')
  return f
}

describe('cacheKey', () => {
  test('stable, and changes with size or mtime', () => {
    expect(cacheKey(null, '/a', 1, 2)).toBe(cacheKey(null, '/a', 1, 2))
    expect(cacheKey(null, '/a', 1, 2)).not.toBe(cacheKey(null, '/a', 3, 2))
    expect(cacheKey(null, '/a', 1, 2)).not.toBe(cacheKey(null, '/a', 1, 3))
    expect(cacheKey('h', '/a', 1, 2)).not.toBe(cacheKey(null, '/a', 1, 2))
  })
})

describe('ArchiveCaches', () => {
  const make = () => {
    const remove = vi.fn(async () => {})
    return { remove, c: new ArchiveCaches({ base: '/b', remove }) }
  }
  test('deletes a cache only when its last holder releases', async () => {
    const { c, remove } = make()
    c.acquire(null, '/c', 'p1')
    c.acquire(null, '/c', 'p2')
    expect(c.holders('/c')).toBe(2)
    await c.release('p1')
    expect(remove).not.toHaveBeenCalled()
    await c.release('p2')
    expect(remove).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith(null, '/c')
  })
  test('releaseAll removes every held cache; release(holder) drops all of its caches', async () => {
    const { c, remove } = make()
    c.acquire(null, '/c1', 'p1')
    c.acquire('h', '/c2', 'p1')
    c.acquire(null, '/c3', 'p2')
    await c.release('p1')
    expect(remove.mock.calls).toEqual([[null, '/c1'], ['h', '/c2']])
    await c.releaseAll()
    expect(remove).toHaveBeenCalledTimes(3)
    expect(remove).toHaveBeenLastCalledWith(null, '/c3')
  })
  test('the clipboard holder keeps a cache alive; releasing a non-holder is a no-op', async () => {
    const { c, remove } = make()
    c.acquire(null, '/c', 'p1')
    c.acquire(null, '/c', 'clipboard')
    await c.release('p1')
    expect(remove).not.toHaveBeenCalled()
    await c.release('nobody')
    expect(remove).not.toHaveBeenCalled()
    await c.release('clipboard')
    expect(remove).toHaveBeenCalledOnce()
  })
})

describe('openLocal', () => {
  test('extracts, then reuses the cache without extracting again', async () => {
    const base = dir()
    const a = archive()
    const { root, hidden } = await openLocal(base, a, sig())
    expect(readFileSync(join(root, 'a/b.txt'), 'utf8')).toBe('hello')
    expect(hidden).toBe(0)
    const m = statSync(root).mtimeMs
    expect((await openLocal(base, a, sig())).root).toBe(root)
    expect(statSync(root).mtimeMs).toBe(m)
  })
  test('cleans up a failed extraction', async () => {
    const base = dir()
    await expect(openLocal(base, corrupt(), sig())).rejects.toThrow()
    expect(readdirSync(base)).toEqual([])
  })
  test('removes symlinks leaving the cache', async () => {
    const { root, hidden } = await openLocal(dir(), archive(true), sig())
    expect(hidden).toBe(3)
    expect(readdirSync(root).sort()).toEqual(['a', 'in', 'q'])
  })
})

describe('remoteOpenScript', () => {
  const run = (a: string, d = remoteCacheDir()) => ({ d, r: spawnSync('/bin/sh', ['-c', remoteOpenScript(a, d)]) })
  test('good archive: extracts into the given dir, 0 removed', () => {
    const { d, r } = run(archive())
    made.push(d)
    expect(r.status).toBe(0)
    expect(r.stdout.toString()).toBe('0')
    expect(readFileSync(join(d, 'a/b.txt'), 'utf8')).toBe('hello')
  })
  test('corrupt archive: fails and removes the dir', () => {
    const { d, r } = run(corrupt())
    expect(r.status).not.toBe(0)
    expect(existsSync(d)).toBe(false)
  })
  test('an existing dir is refused and left alone', () => {
    const d = dir()
    expect(run(archive(), d).r.status).not.toBe(0)
    expect(existsSync(d)).toBe(true)
  })
  test('symlinks leaving the cache are removed and counted', () => {
    const { d, r } = run(archive(true))
    made.push(d)
    expect(r.stdout.toString()).toBe('3')
    expect(readdirSync(d).sort()).toEqual(['a', 'in', 'q'])
  })
})

describe('ownedCache', () => {
  test('only our cache folders may be deleted', () => {
    expect(ownedCache(null, '/u/archives/abc', '/u/archives')).toBe(true)
    expect(ownedCache(null, '/u/archives', '/u/archives')).toBe(false)
    expect(ownedCache(null, '/home/me', '/u/archives')).toBe(false)
    expect(ownedCache(null, '/u/archives/..', '/u/archives')).toBe(false)
    expect(ownedCache(null, '/u/archives/.', '/u/archives')).toBe(false)
    expect(ownedCache(null, '/u/archives/a/b', '/u/archives')).toBe(false)
    expect(ownedCache('h', remoteCacheDir(), '/u/archives')).toBe(true)
    expect(ownedCache('h', '/home/me', '/u/archives')).toBe(false)
    expect(ownedCache('h', '/tmp/cassetto-archive-ab/..', '/u/archives')).toBe(false)
    expect(ownedCache('h', '/tmp', '/u/archives')).toBe(false)
  })
})
