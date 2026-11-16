import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { parseOpOutput, remoteOpScript, runOpLocal, runOpRemote } from '../src/main/fileOps'
import type { FileOp, OpResult } from '../src/shared/types'

const dir = () => mkdtempSync(join(tmpdir(), 'tops-'))
// the remote script, run by the local sh: the same commands a host would run
const sh = async (op: FileOp): Promise<OpResult> => parseOpOutput(execFileSync('/bin/sh', ['-c', remoteOpScript(op)]).toString())
const trashed: string[] = []
const bin = dir()
const local = (op: FileOp) => runOpLocal(op, async p => (trashed.push(p), renameSync(p, join(bin, basename(p) + Math.random()))))

describe.each([['local', local], ['remote script', sh]] as const)('%s', (_, run) => {
  test('touch creates an empty file and never overwrites', async () => {
    const d = dir()
    const p = join(d, 'a.txt')
    expect(await run({ op: 'touch', path: p })).toEqual({ failed: [] })
    expect(readFileSync(p, 'utf8')).toBe('')
    writeFileSync(p, 'keep')
    expect((await run({ op: 'touch', path: p })).failed).toEqual([{ path: p, error: 'Esiste già' }])
    expect(readFileSync(p, 'utf8')).toBe('keep')
  })

  test('mkdir refuses an existing name', async () => {
    const d = dir()
    expect(await run({ op: 'mkdir', path: join(d, 'n') })).toEqual({ failed: [] })
    expect((await run({ op: 'mkdir', path: join(d, 'n') })).failed[0].error).toBe('Esiste già')
  })

  test('copy without replace leaves an existing destination alone', async () => {
    const d = dir()
    writeFileSync(join(d, 's'), 'src')
    writeFileSync(join(d, 'd'), 'dest')
    const r = await run({ op: 'copy', items: [{ src: join(d, 's'), dest: join(d, 'd'), replace: false }] })
    expect(r.failed).toEqual([{ path: join(d, 's'), error: 'Esiste già' }])
    expect(readFileSync(join(d, 'd'), 'utf8')).toBe('dest')
  })

  test('copy with replace puts the source in place of the destination', async () => {
    const d = dir()
    writeFileSync(join(d, 's'), 'src')
    mkdirSync(join(d, 'd'))
    expect(await run({ op: 'copy', items: [{ src: join(d, 's'), dest: join(d, 'd'), replace: true }] })).toEqual({ failed: [] })
    expect(readFileSync(join(d, 'd'), 'utf8')).toBe('src')
    expect(readFileSync(join(d, 's'), 'utf8')).toBe('src')
  })

  test('move carries a folder with its content', async () => {
    const d = dir()
    mkdirSync(join(d, 'f'))
    writeFileSync(join(d, 'f', 'x'), '1')
    mkdirSync(join(d, 'to'))
    expect(await run({ op: 'move', items: [{ src: join(d, 'f'), dest: join(d, 'to', 'f'), replace: false }] })).toEqual({ failed: [] })
    expect(existsSync(join(d, 'f'))).toBe(false)
    expect(readFileSync(join(d, 'to', 'f', 'x'), 'utf8')).toBe('1')
  })

  test('a hostile name is handled as that exact file', async () => {
    const d = dir()
    const name = `a 'b' $c -d`
    expect(await run({ op: 'touch', path: join(d, name) })).toEqual({ failed: [] })
    expect(await run({ op: 'rename', from: join(d, name), to: join(d, `${name} 2`) })).toEqual({ failed: [] })
    expect(readdirSync(d)).toEqual([`${name} 2`])
    expect(await run({ op: 'delete', paths: [join(d, `${name} 2`)] })).toEqual({ failed: [] })
    expect(readdirSync(d)).toEqual([])
  })

  test('a rename that only changes the case goes through', async () => {
    const d = dir()
    writeFileSync(join(d, 'note'), 'n')
    expect(await run({ op: 'rename', from: join(d, 'note'), to: join(d, 'Note') })).toEqual({ failed: [] })
    expect(readdirSync(d)).toEqual(['Note'])
  })

  test('rename of a folder onto an existing folder fails and keeps both', async () => {
    const d = dir()
    mkdirSync(join(d, 'a'))
    mkdirSync(join(d, 'b'))
    writeFileSync(join(d, 'a', 'x'), '1')
    expect((await run({ op: 'rename', from: join(d, 'a'), to: join(d, 'b') })).failed[0].error).toBe('Esiste già')
    expect(readdirSync(join(d, 'a'))).toEqual(['x'])
  })

  test('rename onto an existing name fails', async () => {
    const d = dir()
    writeFileSync(join(d, 'a'), 'a')
    writeFileSync(join(d, 'b'), 'b')
    expect((await run({ op: 'rename', from: join(d, 'a'), to: join(d, 'b') })).failed[0].error).toBe('Esiste già')
    expect(readFileSync(join(d, 'b'), 'utf8')).toBe('b')
  })
})

test('local replace sends the old destination to the trash', async () => {
  const d = dir()
  writeFileSync(join(d, 's'), 'src')
  writeFileSync(join(d, 'd'), 'dest')
  await local({ op: 'copy', items: [{ src: join(d, 's'), dest: join(d, 'd'), replace: true }] })
  expect(trashed).toContain(join(d, 'd'))
})

test('a failing trash leaves the file where it was', async () => {
  const d = dir()
  writeFileSync(join(d, 'a'), 'a')
  const r = await runOpLocal({ op: 'trash', paths: [join(d, 'a')] }, async () => {
    throw new Error('no trash')
  })
  expect(r.failed).toEqual([{ path: join(d, 'a'), error: 'no trash' }])
  expect(existsSync(join(d, 'a'))).toBe(true)
})

test('trash on a remote host is refused', async () => {
  expect((await sh({ op: 'trash', paths: ['/x'] })).failed).toHaveLength(1)
})

test('parseOpOutput', () => {
  expect(parseOpOutput('Oa\0Eb\0boom\0')).toEqual({ failed: [{ path: 'b', error: 'boom' }] })
})

test('a remote failure keeps a path with a tab whole', async () => {
  const d = dir()
  const p = join(d, 'a\tb')
  writeFileSync(p, 'x')
  expect((await sh({ op: 'touch', path: p })).failed).toEqual([{ path: p, error: 'Esiste già' }])
})

test('remote touch never truncates a file that appears after the check', () => {
  expect(remoteOpScript({ op: 'touch', path: '/x' })).toContain('set -C')
})

test('a failed ssh run says the outcome is unknown, not that every item failed', async () => {
  const r = await runOpRemote('-bad host', { op: 'delete', paths: ['/a', '/b'] })
  expect(r.failed.map(f => f.path)).toEqual(['/a', '/b'])
  expect(r.failed[0].error).toContain('esito incerto')
})
