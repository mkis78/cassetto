import { expect, test, describe } from 'vitest'
import { claudeLaunch, claudePath, forgetClaudePath, hookSettings, shouldFallbackToNewSession, useCswap, withLocalBin } from '../src/main/claude'
import type { ClaudeParams } from '../src/shared/types'

const claude = (o: Partial<ClaudeParams> = {}): ClaudeParams => ({ kind: 'claude', cwd: '/repo', sessionId: 'abc', started: false, ...o })
const env = { sock: '/tmp/s.sock', tileId: 't1', cswap: true, path: '/bin:/h/.local/bin' }

describe('claudeLaunch', () => {
  test('new claude with account uses --session-id', () => {
    const l = claudeLaunch(claude({ account: '2' }), env)
    expect(l.file).toBe('cswap')
    expect(l.args.slice(0, 5)).toEqual(['run', '2', '--', '--session-id', 'abc'])
    expect(l.cwd).toBe('/repo')
  })

  test('without cswap claude runs directly and ignores a saved account', () => {
    const l = claudeLaunch(claude({ account: '2', started: true }), { ...env, cswap: false })
    expect(l.file).toBe('claude')
    expect(l.args.slice(0, 2)).toEqual(['--resume', 'abc'])
  })

  test('started claude without account resumes', () => {
    expect(claudeLaunch(claude({ started: true }), env).args.slice(0, 4)).toEqual(['run', '--', '--resume', 'abc'])
  })

  test('a cwd with spaces stays one value (no shell involved)', () => {
    expect(claudeLaunch(claude({ cwd: '/Users/x/My Repo' }), env).cwd).toBe('/Users/x/My Repo')
  })

  test('env carries the tile id, the socket and the Claude PATH, with the hook settings as an argument', () => {
    const l = claudeLaunch(claude(), env)
    expect(l.env).toEqual({ CASSETTO_TILE: 't1', CASSETTO_SOCK: '/tmp/s.sock', PATH: '/bin:/h/.local/bin' })
    const i = l.args.indexOf('--settings')
    expect(JSON.parse(l.args[i + 1])).toEqual(hookSettings())
  })
})

describe('hookSettings', () => {
  test('every hook is a bounded curl that cannot fail Claude, nothing else', () => {
    const h = hookSettings() as { hooks: Record<string, { hooks: { command: string }[] }[]> }
    expect(Object.keys(h.hooks).sort()).toEqual(['Notification', 'PostToolUse', 'Stop', 'UserPromptSubmit'])
    for (const entries of Object.values(h.hooks))
      for (const e of entries)
        for (const { command } of e.hooks) {
          expect(command).toMatch(/^curl -s -m 2 --unix-socket "\$CASSETTO_SOCK" "http:\/\/t\/(prompt|tool|permission|stop)\/\$CASSETTO_TILE" >\/dev\/null 2>&1 \|\| true$/)
        }
  })
})

describe('shouldFallbackToNewSession', () => {
  const missing = 'No conversation found with session ID: abc'
  test('a resumed session claude does not know is replaced', () => expect(shouldFallbackToNewSession(claude({ started: true }), 1, missing)).toBe(true))
  test('new session does not', () => expect(shouldFallbackToNewSession(claude(), 1, missing)).toBe(false))
  test('another failure keeps the id', () => expect(shouldFallbackToNewSession(claude({ started: true }), 127, 'cswap: not found')).toBe(false))
  test('a clean exit keeps it', () => expect(shouldFallbackToNewSession(claude({ started: true }), 0, missing)).toBe(false))
  test('not a claude tab', () => expect(shouldFallbackToNewSession({ kind: 'terminal' }, 1, missing)).toBe(false))
})

describe('useCswap', () => {
  const ok = (n: number) => ({ accounts: new Array(n).fill({}), error: null })
  test('missing cswap -> plain claude', () => expect(useCswap(false, ok(2))).toBe(false))
  test('ok with accounts -> cswap', () => expect(useCswap(true, ok(2))).toBe(true))
  test('ok with no accounts -> plain claude', () => expect(useCswap(true, ok(0))).toBe(false))
  test('a failed list keeps cswap (resume stays on the right account)', () => expect(useCswap(true, { accounts: [], error: 'x' })).toBe(true))
})

test('withLocalBin appends ~/.local/bin once', () => {
  expect(withLocalBin('/bin', '/h')).toBe('/bin:/h/.local/bin')
  expect(withLocalBin('/bin:/h/.local/bin', '/h')).toBe('/bin:/h/.local/bin')
})

test('claudePath is built once, for Claude only: the app PATH is left alone', async () => {
  const before = process.env.PATH
  const p = claudePath('/no/such/shell', '/h') // the login shell fails: the inherited PATH plus ~/.local/bin
  expect(await p).toBe(`${before}:/h/.local/bin`)
  expect(claudePath('/bin/sh', '/other')).toBe(p)
  expect(process.env.PATH).toBe(before)
})

test('forgetClaudePath makes the next use read the login shell again', async () => {
  const first = claudePath('/no/such/shell', '/h')
  await first
  forgetClaudePath()
  const again = claudePath('/no/such/shell', '/other')
  expect(again).not.toBe(first)
  expect(await again).toBe(`${process.env.PATH}:/other/.local/bin`)
})
