import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { assertPrivateDir, isValidHost, onPath, parseRemoteListing, parseSshHosts, remoteListScript, remoteSh, shQuote, sshError, sshOptions, sshRun } from '../src/main/ssh'

test('hosts: aliases, no wildcards, includes, no duplicates', () => {
  const text = 'Host a b\n  HostName 1.2.3.4\nHost *.x\nHost !c\nInclude ~/.orbstack/ssh/config\nhost a\n'
  const inc = (p: string) => (p === '~/.orbstack/ssh/config' ? ['Host orb\n  User x\n'] : [])
  expect(parseSshHosts(text, inc)).toEqual(['a', 'b', 'orb'])
  expect(parseSshHosts('', inc)).toEqual([])
  expect(parseSshHosts('Host=eq1\nHost = eq2\nHOST up # comment\nHost "quoted"\n', inc)).toEqual(['eq1', 'eq2', 'up', 'quoted'])
})

test('the control dir must be ours and private', () => {
  const d = mkdtempSync(join(tmpdir(), 'tcd-'))
  chmodSync(d, 0o700)
  expect(() => assertPrivateDir(d)).not.toThrow()
  chmodSync(d, 0o777)
  expect(() => assertPrivateDir(d)).toThrow()
})

test('onPath finds executables on PATH', () => {
  expect(onPath('sh', '/usr/bin:/bin')).toBe(true)
  expect(onPath('nonexistent-cmd-xyz', '/usr/bin:/bin')).toBe(false)
})

test('a killed ssh says timeout instead of dumping its arguments', () => {
  expect(sshError({ killed: true, message: 'Command failed: ssh -o …' }, '', 'orb')).toBe('Timeout: orb non risponde')
  expect(sshError({ killed: false, message: 'Command failed' }, 'Permission denied\n', 'orb')).toBe('Permission denied')
})

test('shQuote survives a real shell', () => {
  const s = "it's $HOME `x` \\n"
  expect(shQuote("it's $HOME")).toBe(`'it'\\''s $HOME'`)
  expect(execFileSync('sh', ['-c', `printf %s ${shQuote(s)}`]).toString()).toBe(s)
})

test('valid hosts', () => {
  for (const ok of ['orb', 'user@h.x', 'h-1']) expect(isValidHost(ok)).toBe(true)
  for (const bad of ['-oProxyCommand=x', 'a b', 'a;b', '']) expect(isValidHost(bad)).toBe(false)
})

test('shared connection options', () => {
  const o = sshOptions()
  expect(o).toContain('ControlMaster=auto')
  expect(o).toContain('ControlPersist=10m')
  const path = o.find(x => x.startsWith('ControlPath='))!
  expect(path).toMatch(/^ControlPath=\/tmp\/cassetto-\d+\/%C$/)
})

// the remote login shell may be sh, bash, csh or tcsh: the listing must work through each of them
// the shells a remote host may log in with; the ones missing here (zsh/csh on CI runners) are skipped
const shells = ['/bin/sh', '/bin/bash', '/bin/zsh', '/bin/csh', '/bin/tcsh'].filter(s => existsSync(s))

for (const shell of shells) {
  test(`remote listing through ${shell}: odd names, symlinks to folders, broken links`, () => {
    const d = realpathSync(mkdtempSync(join(tmpdir(), "tls '$x")))
    mkdirSync(join(d, 'real dir'))
    writeFileSync(join(d, 'f.txt'), '')
    writeFileSync(join(d, "it's $HOME.txt"), '')
    writeFileSync(join(d, 'new\nline'), '')
    writeFileSync(join(d, "back\\slash \\' q"), '')
    writeFileSync(join(d, '.hidden'), '')
    symlinkSync(join(d, 'real dir'), join(d, 'link'))
    symlinkSync(join(d, 'missing'), join(d, 'broken'))
    const out = execFileSync(shell, ['-c', remoteSh(remoteListScript(d))])
    const l = parseRemoteListing(out.toString('latin1'))
    expect(l.path).toBe(d)
    expect(l.entries.map(({ name, dir }) => ({ name, dir }))).toEqual([
      { name: 'link', dir: true },
      { name: 'real dir', dir: true },
      { name: '.hidden', dir: false },
      { name: "back\\slash \\' q", dir: false },
      { name: 'broken', dir: false },
      { name: 'f.txt', dir: false },
      { name: "it's $HOME.txt", dir: false },
      { name: 'new\nline', dir: false }
    ])
    // GNU stat (Linux) adds size and date, odd names included; BSD stat (macOS) leaves them out; a broken link never has them
    const gnu = spawnSync('stat', ['--version']).status === 0
    for (const name of ['f.txt', "it's $HOME.txt", 'new\nline']) expect(l.entries.find(e => e.name === name)).toMatchObject(gnu ? { size: 0, mtime: expect.any(Number) } : {})
    expect(l.entries.find(e => e.name === 'broken')!.size).toBeUndefined()
  })
}

test('what the login shell sees has no quotes or backslashes to interpret', () => {
  const cmd = remoteSh(`printf %s ${shQuote("a\\'b $x `y` \n z")}`)
  expect(cmd).toMatch(/^sh -c 'eval "\$\(echo [A-Za-z0-9+/=]+ \| base64 -d\)"'$/)
  for (const shell of shells) {
    expect(execFileSync(shell, ['-c', cmd]).toString()).toBe("a\\'b $x `y` \n z")
  }
})

test('home listing when no path is given', () => {
  const out = execFileSync('/bin/sh', ['-c', remoteSh(remoteListScript(null))], { cwd: '/', env: { ...process.env, HOME: tmpdir() } }).toString()
  expect(parseRemoteListing(out).path).toBe(realpathSync(tmpdir()))
})

test('remote listing: size and date from GNU stat records, none without them', () => {
  const out = ['/srv', 'ddocs', 'fa\tb.txt', 'fbroken', 's4096\t1700000000\tdocs', 's12\t1700000001\ta\tb.txt', ''].join('\0')
  expect(parseRemoteListing(out)).toEqual({
    path: '/srv',
    entries: [
      { name: 'docs', dir: true, size: 4096, mtime: 1700000000000 },
      { name: 'a\tb.txt', dir: false, size: 12, mtime: 1700000001000 },
      { name: 'broken', dir: false } // stat -L skips a broken link
    ]
  })
})

test('an ssh that exits before reading its input is a failed run, not a crash', async () => {
  const bin = mkdtempSync(join(tmpdir(), 'tssh-'))
  writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nexit 255\n')
  chmodSync(join(bin, 'ssh'), 0o755)
  const path = process.env.PATH
  process.env.PATH = `${bin}:${path}`
  const crashes: unknown[] = []
  const catcher = (e: unknown) => crashes.push(e)
  process.on('uncaughtException', catcher)
  try {
    const r = await sshRun('host', 'true', { input: 'x'.repeat(4 * 1024 * 1024) })
    await new Promise(r => setTimeout(r, 50))
    expect(r.ok).toBe(false)
    expect(crashes).toEqual([])
  } finally {
    process.env.PATH = path
    process.off('uncaughtException', catcher)
  }
})
