import { execFile } from 'node:child_process'
import type { ClaudeEvent, ClaudeParams } from '../shared/types'
import type { Launch } from './terminal'

// Plain claude only when cswap is absent or reported zero accounts; a failed list keeps cswap so --resume stays on the right account.
export function useCswap(onPathCswap: boolean, list: { accounts: unknown[]; error: string | null }): boolean {
  return onPathCswap && (list.error !== null || list.accounts.length > 0)
}

export function claudeLaunch(p: ClaudeParams, ctx: { sock: string; tileId: string; cswap: boolean; path: string }): Launch {
  const session = p.started ? ['--resume', p.sessionId] : ['--session-id', p.sessionId]
  const rest = [...session, '--settings', JSON.stringify(hookSettings())]
  return {
    file: ctx.cswap ? 'cswap' : 'claude',
    args: ctx.cswap ? ['run', ...(p.account ? [p.account] : []), '--', ...rest] : rest,
    cwd: p.cwd,
    env: { CASSETTO_TILE: ctx.tileId, CASSETTO_SOCK: ctx.sock, PATH: ctx.path }
  }
}

// Passed only to Claudes launched by the app (never written to ~/.claude/settings.json).
// A hook must never block or break Claude, hence the timeout and `|| true`.
export function hookSettings(): object {
  const hook = (e: ClaudeEvent, matcher?: string) => [
    { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command: `curl -s -m 2 --unix-socket "$CASSETTO_SOCK" "http://t/${e}/$CASSETTO_TILE" >/dev/null 2>&1 || true` }] }
  ]
  return {
    hooks: {
      UserPromptSubmit: hook('prompt'),
      PostToolUse: hook('tool'),
      Notification: hook('permission', 'permission_prompt|elicitation_dialog'),
      Stop: hook('stop')
    }
  }
}

// Only a session claude itself reports as missing (closed before the first message) is replaced;
// any other failure (cswap missing, folder gone) keeps the id so the conversation is not lost.
export function shouldFallbackToNewSession(p: { kind: string; started?: boolean }, exitCode: number, output: string): boolean {
  return p.kind === 'claude' && !!p.started && exitCode !== 0 && output.includes('No conversation found with session ID')
}

// claude and cswap usually live in ~/.local/bin, which an app started from the Dock or a launcher may not have on PATH
export const withLocalBin = (path: string, home: string): string => {
  const bin = `${home}/.local/bin`
  return path.split(':').includes(bin) ? path : `${path}:${bin}`
}

// Apps started from the Dock or a launcher get a bare PATH: claude and cswap get the user's login-shell PATH, only them.
// process.env.PATH stays as inherited for terminals, git, ssh and find (a login PATH may put GNU tools first).
// Asked on the first use of Claude, never at startup; asked again after forgetClaudePath (a tool was missing: maybe installed since).
let claudePathP: Promise<string> | null = null
export function claudePath(shell: string, home: string): Promise<string> {
  return (claudePathP ??= new Promise(resolve => {
    const base = process.env.PATH ?? ''
    if (process.platform === 'win32') return resolve(withLocalBin(base, home))
    // execFile answers when stdout closes: a background job started by the shell's rc files can keep it open
    // well past the timeout's kill, so the inherited PATH is taken after 6 s whatever the shell is doing
    const late = setTimeout(() => resolve(withLocalBin(base, home)), 6000)
    execFile(shell, ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'], { encoding: 'utf8', timeout: 5000 }, (_err, out) => {
      clearTimeout(late)
      resolve(withLocalBin(String(out ?? '').match(/__PATH__(.*)__PATH__/)?.[1] ?? base, home))
    })
  }))
}
export const forgetClaudePath = () => void (claudePathP = null)
