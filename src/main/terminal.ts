import type { IPty, spawn } from 'node-pty'
import { isValidHost, remoteSh, shQuote } from './ssh'
import { t } from '../shared/i18n'

export type SpawnFn = typeof spawn
export interface Launch {
  file: string
  args: string[]
  cwd: string
  env?: Record<string, string> // over the inherited environment
}

// a terminal tab: a login shell in `cwd`, here or on `host` (then `cwd` is a folder there)
export function terminalLaunch(p: { host: string | null; cwd: string }, ctx: { shell: string; home: string; sshOptions: () => string[] }): Launch {
  if (!p.host) return { file: ctx.shell, args: ['-l'], cwd: p.cwd }
  if (!isValidHost(p.host)) throw new Error(t('Host non valido: {host}', { host: p.host }))
  // the remote login shell, started in the folder; a folder that is gone leaves it in the home with a word why
  const notFound = t('Cartella non trovata: {path}', { path: p.cwd }).replace(/["\\$`]/g, '') // inside the echo's double quotes
  const script = `cd -- ${shQuote(p.cwd)} 2>/dev/null || echo "${notFound}"; exec "\${SHELL:-sh}" -l`
  return { file: 'ssh', args: [...ctx.sshOptions(), '-t', p.host, '--', remoteSh(script)], cwd: ctx.home }
}

// Child terminals must not inherit Electron/npm internals (from `npm run dev`) nor look like they run inside Claude Code.
const INHERITED = /^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_PID$|ELECTRON_|npm_|APPIMAGE$|APPDIR$|ARGV0$|OWD$)/

// what any child process inherits: ours minus the internals above
export function childEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !INHERITED.test(k)) out[k] = v
  // the AppImage points LD_LIBRARY_PATH at its own libs; the user's own value is left alone
  const dir = env.APPDIR
  if (dir && out.LD_LIBRARY_PATH?.split(':').some(p => p.startsWith(dir))) delete out.LD_LIBRARY_PATH
  return out
}

export const ptyEnv = (env: Record<string, string | undefined>): Record<string, string> => ({ ...childEnv(env), TERM_PROGRAM: 'cassetto' })

export class PtyManager {
  private ptys = new Map<string, IPty>()

  constructor(private spawn: SpawnFn) {}

  create(id: string, l: Launch, cols: number, rows: number, onData: (d: string) => void, onExit: (code: number) => void): void {
    this.kill(id)
    const p = this.spawn(l.file, l.args, { name: 'xterm-256color', cols, rows, cwd: l.cwd, env: { ...ptyEnv(process.env), ...l.env } })
    this.ptys.set(id, p)
    p.onData(onData)
    p.onExit(({ exitCode }) => {
      // only report exits of the live pty, not of one we killed or replaced
      if (this.ptys.get(id) !== p) return
      this.ptys.delete(id)
      onExit(exitCode)
    })
  }

  pid(id: string): number | undefined {
    return this.ptys.get(id)?.pid
  }

  write(id: string, data: string): void {
    this.ptys.get(id)?.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    if (cols > 0 && rows > 0) this.ptys.get(id)?.resize(cols, rows)
  }

  kill(id: string): void {
    const p = this.ptys.get(id)
    this.ptys.delete(id)
    p?.kill()
  }

  killAll(): void {
    for (const id of [...this.ptys.keys()]) this.kill(id)
  }
}
