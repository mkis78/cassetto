import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { staleSockets, startEventServer } from '../src/main/claudeEvents'

const hit = (sock: string, path: string) =>
  new Promise<number>((res, rej) => request({ socketPath: sock, path }, r => (r.resume(), res(r.statusCode!))).on('error', rej).end())

test('routes hook calls to onEvent, rejects unknown paths, cleans up', async () => {
  const sock = join(mkdtempSync(join(tmpdir(), 'tev-')), 's.sock')
  writeFileSync(sock, '') // stale socket left by a crash
  const got: [string, string][] = []
  const stop = await startEventServer(sock, (id, e) => got.push([id, e]))
  expect(await hit(sock, '/stop/tile-1')).toBe(204)
  expect(await hit(sock, '/permission/abc-2')).toBe(204)
  expect(await hit(sock, '/rm/tile-1')).toBe(404)
  expect(await hit(sock, '/stop/')).toBe(404)
  expect(got).toEqual([['tile-1', 'stop'], ['abc-2', 'permission']])
  stop()
  expect(existsSync(sock)).toBe(false)
})

test('rejects instead of hanging or throwing when the socket cannot be created', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tev-'))
  await expect(startEventServer(join(dir, 'missing-dir', 's.sock'), () => {})).rejects.toThrow()
  mkdirSync(join(dir, 'a-dir'))
  await expect(startEventServer(join(dir, 'a-dir'), () => {})).rejects.toThrow()
})

test('staleSockets picks only our sockets whose process is gone', () => {
  const alive = new Set([100, 200])
  const files = ['cassetto-100.sock', 'cassetto-300.sock', 'cassetto-200.sock', 'other-300.sock', 'cassetto-x.sock', 'cassetto-400.sock.bak']
  expect(staleSockets(files, pid => alive.has(pid))).toEqual(['cassetto-300.sock'])
})
