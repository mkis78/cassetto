import { expect, test } from 'vitest'
import { PtyManager, ptyEnv, terminalLaunch, type SpawnFn } from '../src/main/terminal'

function fakeSpawn() {
  const spawned: { killed: number; written: string[] }[] = []
  const spawn: SpawnFn = () => {
    const p = { killed: 0, written: [] as string[] }
    spawned.push(p)
    return {
      onData: () => ({ dispose() {} }),
      onExit: () => ({ dispose() {} }),
      write: (d: string) => p.written.push(d),
      resize: () => {},
      kill: () => { p.killed++ }
    } as never
  }
  return { spawn, spawned }
}

const launch = { file: '/bin/zsh', args: [], cwd: '/' }
const noop = () => {}

test('kill terminates the pty and later writes are ignored', () => {
  const { spawn, spawned } = fakeSpawn()
  const m = new PtyManager(spawn)
  m.create('a', launch, 80, 24, noop, noop)
  m.kill('a')
  expect(spawned[0].killed).toBe(1)
  expect(() => m.write('a', 'x')).not.toThrow()
  expect(spawned[0].written).toEqual([])
})

test('killAll terminates every pty', () => {
  const { spawn, spawned } = fakeSpawn()
  const m = new PtyManager(spawn)
  m.create('a', launch, 80, 24, noop, noop)
  m.create('b', launch, 80, 24, noop, noop)
  m.killAll()
  expect(spawned.map(p => p.killed)).toEqual([1, 1])
})

test('recreating an id kills the previous pty first', () => {
  const { spawn, spawned } = fakeSpawn()
  const m = new PtyManager(spawn)
  m.create('a', launch, 80, 24, noop, noop)
  m.create('a', launch, 80, 24, noop, noop)
  expect(spawned[0].killed).toBe(1)
  expect(spawned[1].killed).toBe(0)
})

test('a local terminal is a login shell in the folder', () => {
  const ctx = { shell: '/bin/zsh', home: '/Users/x', sshOptions: () => ['-o', 'X=1'] }
  expect(terminalLaunch({ host: null, cwd: '/Users/x/Documenti' }, ctx)).toEqual({ file: '/bin/zsh', args: ['-l'], cwd: '/Users/x/Documenti' })
})

test('a remote one is ssh -t into the folder there, through sh whatever the login shell', () => {
  const ctx = { shell: '/bin/zsh', home: '/Users/x', sshOptions: () => ['-o', 'X=1'] }
  const l = terminalLaunch({ host: 'web1', cwd: "/srv/it's" }, ctx)
  expect(l.file).toBe('ssh')
  expect(l.args.slice(0, 5)).toEqual(['-o', 'X=1', '-t', 'web1', '--'])
  const script = Buffer.from(/echo (\S+) \| base64/.exec(l.args[5])![1], 'base64').toString()
  expect(script).toContain("cd -- '/srv/it'\\''s'")
  expect(script).toContain('exec "${SHELL:-sh}" -l')
  expect(l.cwd).toBe('/Users/x')
  expect(() => terminalLaunch({ host: '-oProxyCommand=x', cwd: '/' }, ctx)).toThrow()
})

test('the environment drops what the app inherited from Electron, npm and Claude Code', () => {
  const env = ptyEnv({ PATH: '/bin', HOME: '/h', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', ELECTRON_RENDERER_URL: 'http://x', npm_config_prefix: '/p', UNDEF: undefined })
  expect(env).toEqual({ PATH: '/bin', HOME: '/h', TERM_PROGRAM: 'cassetto' })
})

test('a launch env goes over the inherited one', () => {
  let env: Record<string, string> = {}
  const m = new PtyManager(((_f: string, _a: string[], o: { env: Record<string, string> }) => ((env = o.env), { onData() {}, onExit() {} })) as never)
  m.create('a', { ...launch, env: { CASSETTO_TILE: 't' } }, 80, 24, noop, noop)
  expect(env).toMatchObject({ CASSETTO_TILE: 't', TERM_PROGRAM: 'cassetto' })
})
