import { execFile } from 'node:child_process'
import { accessSync, chmodSync, constants, lstatSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { sortEntries } from '../shared/sortEntries'
import type { Listing, ListResult, Preview, ReadResult, WriteResult } from '../shared/types'
import { mediaOf } from './mediaPreview'
import { EDIT_LIMIT, previewLimit, toPreview, toText } from './files'
import { t } from '../shared/i18n'

// Host aliases from an ssh config, without patterns; Include is followed one level deep.
export function parseSshHosts(text: string, readInclude: (pattern: string) => string[]): string[] {
  const hosts: string[] = []
  const add = (t: string) => {
    for (const line of t.split('\n')) {
      // "Host a b", "Host=a", "host = a  # comment", Host "a"
      const [key, ...rest] = line.replace(/#.*/, '').trim().split(/[\s=]+/).map(w => w.replace(/^"|"$/g, ''))
      if (/^host$/i.test(key)) rest.filter(h => h && !/[*?!]/.test(h)).forEach(h => hosts.includes(h) || hosts.push(h))
    }
  }
  add(text)
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^include\s+(.+)$/i)
    if (m) m[1].split(/\s+/).forEach(p => readInclude(p).forEach(add))
  }
  return hosts
}

function readInclude(pattern: string): string[] {
  const p = pattern.startsWith('~/') ? join(homedir(), pattern.slice(2)) : pattern.startsWith('/') ? pattern : join(homedir(), '.ssh', pattern)
  // ponytail: only a `*` in the file name is expanded, not in directories
  const files = basename(p).includes('*')
    ? (() => {
        const re = new RegExp('^' + basename(p).split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$')
        try {
          return readdirSync(dirname(p)).filter(f => re.test(f)).map(f => join(dirname(p), f))
        } catch {
          return []
        }
      })()
    : [p]
  return files.flatMap(f => {
    try {
      return [readFileSync(f, 'utf8')]
    } catch {
      return []
    }
  })
}

export function listSshHosts(): string[] {
  try {
    return parseSshHosts(readFileSync(join(homedir(), '.ssh', 'config'), 'utf8'), readInclude)
  } catch {
    return []
  }
}

export const isValidHost = (h: string): boolean => /^[\w.@-]+$/.test(h) && !h.startsWith('-')

export const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

// /tmp is shared: another user could create our folder first and plant sockets in it
export function assertPrivateDir(d: string): void {
  const st = lstatSync(d)
  if (!st.isDirectory() || st.uid !== process.getuid?.() || (st.mode & 0o077) !== 0) {
    throw new Error(t('{dir} non è una cartella privata di questo utente: rimuovila e riprova', { dir: d }))
  }
}

// short on purpose: macOS caps socket paths at 104 chars and ssh appends a temporary suffix
export function controlDir(): string {
  const d = `/tmp/cassetto-${process.getuid?.() ?? 0}`
  mkdirSync(d, { recursive: true, mode: 0o700 })
  if (lstatSync(d).uid === process.getuid?.()) chmodSync(d, 0o700)
  assertPrivateDir(d)
  return d
}

export function onPath(cmd: string, path = process.env.PATH ?? ''): boolean {
  return path.split(':').some(dir => {
    try {
      accessSync(join(dir, cmd), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

export function sshError(err: { killed?: boolean; message: string }, stderr: string, host: string): string {
  if (err.killed) return t('Timeout: {host} non risponde', { host })
  return stderr.trim() || err.message
}

export const sshOptions = (): string[] => ['-o', 'ControlMaster=auto', '-o', `ControlPath=${controlDir()}/%C`, '-o', 'ControlPersist=10m']

// ssh hands the command to the user's login shell (bash, csh, fish…), and each reads quotes and backslashes its own way.
// The login shell only ever sees base64 characters inside single quotes; the real script is read by sh alone.
export const remoteSh = (script: string): string => `sh -c 'eval "$(echo ${Buffer.from(script).toString('base64')} | base64 -d)"'`

// Runs under sh whatever the login shell is. NUL-separated so any file name survives;
// [ -d ] follows symlinks to folders; broken links are listed as files.
// Size and date come from one GNU stat call ("s<size>\t<mtime>\t<name>"); a BSD stat (macOS hosts) has no
// NUL output, so there the list stays without them.
export function remoteListScript(path: string | null): string {
  return (
    `${path === null ? 'cd' : `cd -- ${shQuote(path)}`} && printf '%s\\0' "$(pwd -P)" && ` +
    `for f in * .*; do case "$f" in .|..) continue;; esac; ` +
    `if [ -d "$f" ]; then printf 'd%s\\0' "$f"; elif [ -e "$f" ] || [ -L "$f" ]; then printf 'f%s\\0' "$f"; fi; done; ` +
    `if stat --version >/dev/null 2>&1; then stat -L --printf 's%s\\t%Y\\t%n\\0' -- * .* 2>/dev/null; fi; true`
  )
}

export function parseRemoteListing(out: string): Listing {
  const [path, ...items] = out.split('\0').filter(Boolean)
  const stats = new Map<string, { size: number; mtime: number }>()
  for (const i of items.filter(i => i[0] === 's')) {
    const [size, mtime, ...name] = i.slice(1).split('\t')
    stats.set(name.join('\t'), { size: Number(size), mtime: Number(mtime) * 1000 })
  }
  const entries = items.filter(i => i[0] === 'd' || i[0] === 'f').map(i => ({ name: i.slice(1), dir: i[0] === 'd', ...stats.get(i.slice(1)) }))
  return { path, entries: sortEntries(entries) }
}

// Runs `script` under sh on `host` over the shared connection, `input` on its stdin.
// BatchMode: never ask for input here; the user authenticates in an SSH tile, which opens the shared connection
export function sshRun(host: string, script: string, o: { input?: string; maxBuffer?: number; timeout?: number; signal?: AbortSignal } = {}): Promise<{ ok: true; out: Buffer } | { ok: false; error: string }> {
  if (!isValidHost(host)) return Promise.resolve({ ok: false, error: t('Host non valido: {host}', { host }) })
  let opts: string[]
  try {
    opts = sshOptions()
  } catch (e) {
    return Promise.resolve({ ok: false, error: (e as Error).message })
  }
  const args = [...opts, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, '--', remoteSh(script)]
  return new Promise(resolve => {
    const child = execFile('ssh', args, { encoding: 'buffer', timeout: o.timeout ?? 30_000, maxBuffer: o.maxBuffer ?? 20 * 1024 * 1024, signal: o.signal }, (err, stdout, stderr) =>
      resolve(err ? { ok: false, error: sshError(err, stderr.toString(), host) } : { ok: true, out: stdout })
    )
    child.stdin?.end(o.input ?? '')
  })
}

export async function listRemote(host: string, path: string | null): Promise<ListResult> {
  const r = await sshRun(host, remoteListScript(path), { timeout: 20_000 })
  return r.ok ? { ok: true, listing: parseRemoteListing(r.out.toString()) } : r
}

export async function previewRemote(host: string, path: string): Promise<Preview> {
  if (mediaOf(path)) return { kind: 'error', error: t('Anteprima di PDF, video e audio non disponibile sui server') } // decided: not worth downloading it all
  const r = await sshRun(host, `head -c ${previewLimit(path) + 1} -- ${shQuote(path)}`, { maxBuffer: previewLimit(path) + 1024 })
  return r.ok ? toPreview(path, r.out) : { kind: 'error', error: r.error }
}

export async function readRemote(host: string, path: string): Promise<ReadResult> {
  const r = await sshRun(host, `head -c ${EDIT_LIMIT + 1} -- ${shQuote(path)}`, { maxBuffer: EDIT_LIMIT + 1024, timeout: 60_000 })
  return r.ok ? toText(r.out) : r
}

// cat > keeps the remote file's permissions and owner, like the local write
export async function writeRemote(host: string, path: string, text: string): Promise<WriteResult> {
  const r = await sshRun(host, `cat > ${shQuote(path)}`, { input: text, timeout: 60_000 })
  return r.ok ? { ok: true } : r
}
