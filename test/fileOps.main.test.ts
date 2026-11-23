import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { extractCommand, fromStdin, parseOpOutput, remoteOpScript, runOpLocal, runOpRemote } from '../src/main/fileOps'
import { remoteSh, sshRun } from '../src/main/ssh'
import type { FileOp, OpResult } from '../src/shared/types'

// host 'local': the command runs under the local sh, wrapped as ssh would send it, with the same stdin
vi.mock('../src/main/ssh', async orig => {
  const ssh = await orig<typeof import('../src/main/ssh')>()
  const local = (cmd: string, input = '') => {
    const r = spawnSync('/bin/sh', ['-c', ssh.remoteSh(cmd)], { input, maxBuffer: 64 * 1024 * 1024 })
    return r.status === 0 ? { ok: true as const, out: r.stdout } : { ok: false as const, error: `exit ${r.status}` }
  }
  return { ...ssh, sshRun: vi.fn((host: string, cmd: string, o: { input?: string } = {}) => (host === 'local' ? Promise.resolve(local(cmd, o.input)) : ssh.sshRun(host, cmd, o))) }
})

// another volume, simulated: rename and link fail with EXDEV while `exdev` is on
let exdev = false
vi.mock('node:fs/promises', async orig => {
  const fs = await orig<typeof import('node:fs/promises')>()
  const cross = <A extends unknown[]>(f: (...a: A) => Promise<void>) => (...a: A) => (exdev ? Promise.reject(Object.assign(new Error('EXDEV'), { code: 'EXDEV' })) : f(...a))
  return { ...fs, rename: cross(fs.rename), link: cross(fs.link) }
})

const dir = () => mkdtempSync(join(tmpdir(), 'tops-'))
// the remote script, run by the local sh: the same commands a host would run
const sh = async (op: FileOp): Promise<OpResult> => parseOpOutput(execFileSync('/bin/sh', ['-c', remoteOpScript(op)]).toString())
const trashed: string[] = []
const bin = dir()
const local = (op: FileOp) =>
  runOpLocal(op, async ps =>
    ps.map(p => {
      trashed.push(p)
      const to = join(bin, basename(p) + Math.random())
      renameSync(p, to)
      return { path: p, trashed: to }
    })
  ).then(({ failed }) => ({ failed }))

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
  const r = await runOpLocal({ op: 'trash', paths: [join(d, 'a')] }, async ps => ps.map(path => ({ path, error: 'no trash' })))
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

// runOpLocal's `trashed`: every item sent to the Trash, with where it went; failures excluded
const fakeBin = (fail: string[] = []) => async (ps: string[]) => ps.map(path => (fail.includes(path) ? { path, error: 'no' } : { path, trashed: `/bin${path}` }))

test('a trash op reports each item and where it went', async () => {
  const r = await runOpLocal({ op: 'trash', paths: ['/x/a', '/x/b'] }, fakeBin())
  expect(r.trashed).toEqual([{ path: '/x/a', trashed: '/bin/x/a' }, { path: '/x/b', trashed: '/bin/x/b' }])
})

test.each(['copy', 'move'] as const)('%s with replace reports the replaced destination', async op => {
  const d = dir()
  writeFileSync(join(d, 's'), 'src')
  writeFileSync(join(d, 'd'), 'dest')
  const r = await runOpLocal({ op, items: [{ src: join(d, 's'), dest: join(d, 'd'), replace: true }] }, fakeBin())
  expect(r.trashed).toEqual([{ path: join(d, 'd'), trashed: `/bin${join(d, 'd')}` }])
})

test('an item the trash refuses is failed, not trashed', async () => {
  const r = await runOpLocal({ op: 'trash', paths: ['/x/a', '/x/b'] }, fakeBin(['/x/a']))
  expect(r.failed).toEqual([{ path: '/x/a', error: 'no' }])
  expect(r.trashed).toEqual([{ path: '/x/b', trashed: '/bin/x/b' }])
})

test('a cross-volume move sends the originals to the Trash in one call', async () => {
  const d = dir()
  const names = ['a', 'b', 'c']
  for (const n of names) writeFileSync(join(d, n), n)
  mkdirSync(join(d, 'to'))
  const calls: string[][] = []
  exdev = true
  const r = await runOpLocal({ op: 'move', items: names.map(n => ({ src: join(d, n), dest: join(d, 'to', n), replace: false })) }, async ps => {
    calls.push(ps)
    return ps.map(path => (path.endsWith('b') ? { path, error: 'no' } : { path, trashed: `/bin${path}` }))
  }).finally(() => (exdev = false))
  expect(calls).toEqual([names.map(n => join(d, n))])
  expect(r.failed).toEqual([{ path: join(d, 'b'), error: "Copiato, ma l'originale non è stato spostato nel Cestino: no" }])
  expect(r.trashed.map(x => x.path)).toEqual([join(d, 'a'), join(d, 'c')])
  for (const n of names) expect(readFileSync(join(d, 'to', n), 'utf8')).toBe(n)
})

test('replaced destinations go to the Trash in one call, before their items are placed', async () => {
  const d = dir()
  const names = ['a', 'b', 'c']
  mkdirSync(join(d, 'to'))
  for (const n of names) writeFileSync(join(d, n), n), writeFileSync(join(d, 'to', n), 'old')
  const calls: string[][] = []
  const r = await runOpLocal({ op: 'copy', items: names.map(n => ({ src: join(d, n), dest: join(d, 'to', n), replace: true })) }, async ps => {
    calls.push(ps)
    return ps.map(path => (path.endsWith('b') ? { path, error: 'no' } : (renameSync(path, path + '.old'), { path, trashed: path + '.old' })))
  })
  expect(calls).toEqual([names.map(n => join(d, 'to', n))])
  expect(r.failed).toEqual([{ path: join(d, 'b'), error: 'no' }])
  expect(names.map(n => readFileSync(join(d, 'to', n), 'utf8'))).toEqual(['a', 'old', 'c'])
})

describe.each([['local', local], ['remote script', sh]] as const)('renameMany, %s', (_, run) => {
  const files = (d: string, names: string[]) => names.forEach(n => writeFileSync(join(d, n), n))
  const read = (d: string) => Object.fromEntries(readdirSync(d).sort().map(n => [n, readFileSync(join(d, n), 'utf8')]))
  const op = (d: string, pairs: [string, string][]): FileOp => ({ op: 'renameMany', items: pairs.map(([a, b]) => ({ from: join(d, a), to: join(d, b) })) })
  const off = 'Annullata la rinomina di tutti gli elementi'

  test('renames a batch', async () => {
    const d = dir()
    files(d, ['a', 'b'])
    expect(await run(op(d, [['a', 'x'], ['b', 'y']]))).toEqual({ failed: [] })
    expect(read(d)).toEqual({ x: 'a', y: 'b' })
  })
  test('swaps two names', async () => {
    const d = dir()
    files(d, ['a', 'b'])
    expect(await run(op(d, [['a', 'b'], ['b', 'a']]))).toEqual({ failed: [] })
    expect(read(d)).toEqual({ a: 'b', b: 'a' })
  })
  test('shifts a sequence', async () => {
    const d = dir()
    files(d, ['f1', 'f2', 'f3'])
    expect(await run(op(d, [['f1', 'f2'], ['f2', 'f3'], ['f3', 'f4']]))).toEqual({ failed: [] })
    expect(read(d)).toEqual({ f2: 'f1', f3: 'f2', f4: 'f3' })
  })
  test('a case-only rename, of a file and of a folder', async () => {
    const d = dir()
    files(d, ['a.txt'])
    mkdirSync(join(d, 'dir'))
    expect(await run(op(d, [['a.txt', 'A.txt'], ['dir', 'DIR']]))).toEqual({ failed: [] })
    expect(readdirSync(d).sort()).toEqual(['A.txt', 'DIR'])
  })
  test('a name taken outside the batch rolls everything back', async () => {
    const d = dir()
    files(d, ['a', 'b', 'c'])
    const o = op(d, [['a', 'b'], ['b', 'a'], ['c', 'z']])
    writeFileSync(join(d, 'z'), 'other')
    expect((await run(o)).failed).toEqual([
      { path: join(d, 'a'), error: off },
      { path: join(d, 'b'), error: off },
      { path: join(d, 'c'), error: 'Esiste già' }
    ])
    expect(read(d)).toEqual({ a: 'a', b: 'b', c: 'c', z: 'other' })
  })
  test('a missing item rolls back the ones already moved aside', async () => {
    const d = dir()
    files(d, ['a', 'c'])
    const r = await run(op(d, [['a', 'x'], ['b', 'y'], ['c', 'z']]))
    expect(r.failed.map(f => f.path)).toEqual([join(d, 'a'), join(d, 'b'), join(d, 'c')])
    expect(r.failed[0].error).toBe(off)
    expect(r.failed[1].error).not.toBe(off)
    expect(read(d)).toEqual({ a: 'a', c: 'c' })
  })
  test('no items: nothing to do', async () => {
    expect(await run({ op: 'renameMany', items: [] })).toEqual({ failed: [] })
  })
  test.each([
    ['a new name in another folder', [['a', 'x'], ['b', 'sub/y']]],
    ['items from two folders', [['a', 'x'], ['sub/c', 'sub/z']]]
  ] as const)('%s: every item fails, nothing moves', async (_, pairs) => {
    const d = dir()
    files(d, ['a', 'b'])
    mkdirSync(join(d, 'sub'))
    writeFileSync(join(d, 'sub', 'c'), 'c')
    const r = await run(op(d, pairs as unknown as [string, string][]))
    expect(r.failed).toEqual(pairs.map(([a]) => ({ path: join(d, a), error: 'Gli elementi devono essere in una sola cartella' })))
    expect(readdirSync(d).sort()).toEqual(['a', 'b', 'sub'])
    expect(readdirSync(join(d, 'sub'))).toEqual(['c'])
  })
})
test('a large remote batch travels on stdin, not argv, and runs whole', async () => {
  const d = dir()
  const names = Array.from({ length: 500 }, (_, n) => `file ${n}`)
  for (const n of names) writeFileSync(join(d, n), n)
  const items = names.map(n => ({ from: join(d, n), to: join(d, `${n}.x`) }))
  expect(await runOpRemote('local', { op: 'renameMany', items })).toEqual({ failed: [] })
  expect(readdirSync(d).sort()).toEqual(names.map(n => `${n}.x`).sort())
  const [, cmd, o] = vi.mocked(sshRun).mock.calls.at(-1)!
  expect(cmd).toMatch(/^s=\$\(cat\) && case \$s in \*'\n# end [0-9a-f]{16}'\)/)
  expect(o?.input).toContain(join(d, 'file 499'))
  expect(remoteSh(cmd).length).toBeLessThan(1000)
}, 30_000) // 500 files through sh: seconds on a slow CI runner

test('a script cut short on stdin runs none of it', () => {
  const d = dir()
  writeFileSync(join(d, 'a'), 'a')
  const script = remoteOpScript({ op: 'renameMany', items: [{ from: join(d, 'a'), to: join(d, 'b') }] })
  const { cmd, input } = fromStdin(script)
  // cut short, or ending in a file name that spells a marker: neither is the one this call expects
  for (const cut of [input.slice(0, input.lastIndexOf('else')), `${script.slice(0, script.lastIndexOf('else'))}\n# end 0123456789abcdef`])
    expect(spawnSync('/bin/sh', ['-c', cmd], { input: cut }).status).not.toBe(0)
  expect(readdirSync(d)).toEqual(['a'])
  expect(spawnSync('/bin/sh', ['-c', cmd], { input }).status).toBe(0)
  expect(readdirSync(d)).toEqual(['b'])
})

test('the remote renameMany ignores a dropped connection, so its rollback finishes', () => {
  expect(remoteOpScript({ op: 'renameMany', items: [{ from: '/d/a', to: '/d/b' }] }).split('\n')[0]).toBe("trap '' HUP PIPE")
})

test('renameMany with no items: an empty remote script', () => expect(remoteOpScript({ op: 'renameMany', items: [] })).toBe(''))

const bsdtar = spawnSync('bsdtar', ['--version']).status === 0
describe('extract', () => {
  // an archive with a/b.txt inside, made with the system tools
  const make = (kind: 'tar.gz' | 'zip' | '7z') => {
    const d = dir()
    mkdirSync(join(d, 'src/a'), { recursive: true })
    writeFileSync(join(d, 'src/a/b.txt'), 'hi')
    const out = join(d, `x.${kind}`)
    if (kind === 'zip') execFileSync('zip', ['-qr', out, 'a'], { cwd: join(d, 'src') })
    else if (kind === '7z') execFileSync('bsdtar', ['--format', '7zip', '-cf', out, '-C', join(d, 'src'), 'a'])
    else execFileSync('tar', ['-czf', out, '-C', join(d, 'src'), 'a'])
    return { d, out }
  }
  describe.each([['local', local], ['remote script', sh]] as const)('%s', (_, run) => {
    test.each(['tar.gz', 'zip', ...(bsdtar ? ['7z' as const] : [])] as const)('%s extracts into a new folder', async kind => {
      const { d, out } = make(kind)
      expect(await run({ op: 'extract', archive: out, dest: join(d, 'x') })).toEqual({ failed: [] })
      expect(readFileSync(join(d, 'x/a/b.txt'), 'utf8')).toBe('hi')
    })
    test('an existing dest fails and is left alone', async () => {
      const { d, out } = make('tar.gz')
      mkdirSync(join(d, 'x'))
      writeFileSync(join(d, 'x/keep'), 'k')
      expect((await run({ op: 'extract', archive: out, dest: join(d, 'x') })).failed).toEqual([{ path: join(d, 'x'), error: 'Esiste già' }])
      expect(readdirSync(join(d, 'x'))).toEqual(['keep'])
    })
    test('a corrupt archive fails and its folder is removed', async () => {
      const d = dir()
      writeFileSync(join(d, 'bad.tar.gz'), 'not an archive')
      const r = await run({ op: 'extract', archive: join(d, 'bad.tar.gz'), dest: join(d, 'bad') })
      expect(r.failed).toHaveLength(1)
      expect(existsSync(join(d, 'bad'))).toBe(false)
    })
  })
  // PATH with unzip but no tar, so the remote script cannot fall back to it
  const shNoTar = async (op: FileOp): Promise<OpResult> => {
    const bin = dir()
    for (const c of ['unzip', 'mkdir', 'rm']) symlinkSync(execFileSync('/bin/sh', ['-c', `command -v ${c}`]).toString().trim(), join(bin, c))
    return parseOpOutput(execFileSync('/bin/sh', ['-c', remoteOpScript(op)], { env: { PATH: bin } }).toString())
  }
  // a zip holding two entries named f, made by python (zip itself never writes a duplicate)
  const py = spawnSync('python3', ['-V']).status === 0
  test.skipIf(!py).each([['local', local], ['remote script', sh], ['remote script, unzip only', shNoTar]] as const)('%s: a zip with a duplicate entry extracts, last one wins', async (_, run) => {
    const d = dir()
    const code = "import sys,zipfile,warnings;warnings.simplefilter('ignore');z=zipfile.ZipFile(sys.argv[1],'w');z.writestr('f','one');z.writestr('f','two');z.close()"
    execFileSync('python3', ['-I', '-c', code, join(d, 'x.zip')])
    expect(await run({ op: 'extract', archive: join(d, 'x.zip'), dest: join(d, 'o') })).toEqual({ failed: [] })
    expect(readFileSync(join(d, 'o/f'), 'utf8')).toBe('two')
  })
  test('extractCommand: bsdtar on macOS, unzip for zip elsewhere', () => {
    expect(extractCommand('darwin', '/a.zip', '/d')).toEqual(['tar', ['-xf', '/a.zip', '-C', '/d']])
    expect(extractCommand('linux', '/a.ZIP', '/d')).toEqual(['unzip', ['-q', '-o', '/a.ZIP', '-d', '/d']])
    expect(extractCommand('linux', '/a.tgz', '/d')).toEqual(['tar', ['-xf', '/a.tgz', '-C', '/d']])
    expect(extractCommand('darwin', '/a.rar', '/d')).toEqual(['tar', ['-xf', '/a.rar', '-C', '/d']])
    const [cmd, args] = extractCommand('linux', '/a b.7z', '/d')
    expect([cmd, args.slice(2)]).toEqual(['sh', ['sh', '/a b.7z', '/d']])
  })
  // the Linux path for 7z/rar, run here: the first of bsdtar, 7z, unrar on PATH extracts it
  test.skipIf(!bsdtar)('extractCommand on Linux extracts a 7z through sh', () => {
    const { d, out } = make('7z')
    mkdirSync(join(d, 'o'))
    const [cmd, args] = extractCommand('linux', out, join(d, 'o'))
    execFileSync(cmd, args)
    expect(readFileSync(join(d, 'o/a/b.txt'), 'utf8')).toBe('hi')
  })
  test('7z/rar with no tool on PATH says which tools are needed', () => {
    const bin = dir()
    for (const c of ['mkdir', 'rm']) symlinkSync(execFileSync('/bin/sh', ['-c', `command -v ${c}`]).toString().trim(), join(bin, c))
    const dest = join(dir(), 'o')
    const r = spawnSync('/bin/sh', ['-c', remoteOpScript({ op: 'extract', archive: '/x.rar', dest })], { env: { PATH: bin } })
    expect(parseOpOutput(r.stdout.toString()).failed).toEqual([{ path: dest, error: 'Per aprire questo archivio serve bsdtar, 7z o unrar' }])
    expect(existsSync(dest)).toBe(false)
  })
})
