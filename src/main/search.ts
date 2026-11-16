import { execFile, spawn } from 'node:child_process'
import type { SearchHit, SearchQuery, SearchResult } from '../shared/types'
import { onPath, shQuote, sshRun } from './ssh'

// outside a repository there is no .gitignore to honour: skip at least these
const SKIP_DIRS = ['.git', 'node_modules']

// lower-case query = ignore case; any capital = match case exactly
const caseSensitive = (t: string) => t !== t.toLowerCase()

// "path\0line\0text" (git grep -z) or "path\0line:text" (grep --null); grep -r prefixes "./"
export function parseContentRecord(rec: string): SearchHit | null {
  const m = rec.match(/^(.*?)\0(\d+)[\0:](.*)$/s)
  return m ? { path: m[1].replace(/^\.\//, ''), line: Number(m[2]), text: m[3] } : null
}

const globToRegex = (g: string) =>
  g
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map(p => (p === '**/' ? '(?:.*/)?' : p === '**' ? '.*' : p === '*' ? '[^/]*' : p === '?' ? '[^/]' : p.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('')

// globs (*.ts, src/**/*.tsx) match the whole path when they contain "/", else the file name;
// a plain word is looked for inside the file name
export function nameMatcher(pattern: string): (path: string) => boolean {
  const flags = caseSensitive(pattern) ? '' : 'i'
  const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
  if (!/[*?]/.test(pattern)) {
    const re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
    return p => re.test(base(p))
  }
  const re = new RegExp(`^${globToRegex(pattern)}$`, flags)
  return pattern.includes('/') ? p => re.test(p) : p => re.test(base(p))
}

// git grep -E on macOS uses POSIX regex, which has no \w \d \s: spell them as classes every grep knows
const CLASSES: Record<string, string> = { w: '[[:alnum:]_]', W: '[^[:alnum:]_]', d: '[[:digit:]]', D: '[^[:digit:]]', s: '[[:space:]]', S: '[^[:space:]]' }
export const posixRegex = (re: string) => re.replace(/\\(.)/g, (m, c: string) => CLASSES[c] ?? m)

const inRepo = (cwd: string) =>
  new Promise<boolean>(ok => execFile('git', ['rev-parse', '--is-inside-work-tree'], { cwd, timeout: 5000 }, (err, out) => ok(!err && out.trim() === 'true')))

function command(q: SearchQuery, git: boolean): [string, string[]] {
  if (q.mode === 'name')
    return git
      ? ['git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard']]
      : ['find', ['.', '(', ...SKIP_DIRS.flatMap((d, i) => [...(i ? ['-o'] : []), '-name', d]), ')', '-prune', '-o', '-type', 'f', '-print0']]
  const pattern = q.regex ? posixRegex(q.text) : q.text
  const opts = [...(caseSensitive(q.text) ? [] : ['-i']), q.regex ? '-E' : '-F', ...(q.word ? ['-w'] : []), '-I', '-n']
  return git
    ? ['git', ['grep', '-z', '--untracked', ...opts, '-e', pattern, '--', '.']]
    : ['grep', ['-r', '--null', ...SKIP_DIRS.map(d => `--exclude-dir=${d}`), ...opts, '-e', pattern, '.']]
}

// one output record as a hit: a file name that matches the pattern, or a content line
const hitOf = (rec: string, match: ((p: string) => boolean) | null): SearchHit | null =>
  match ? (match(rec.replace(/^\.\//, '')) ? { path: rec.replace(/^\.\//, '') } : null) : parseContentRecord(rec)

// Streams the tool's output and stops it as soon as `max` hits are found.
export async function runSearch(cwd: string, q: SearchQuery, max = 1000, signal?: AbortSignal): Promise<SearchResult> {
  const git = onPath('git') && (await inRepo(cwd))
  const [cmd, args] = command(q, git)
  const match = q.mode === 'name' ? nameMatcher(q.text) : null
  // names end with NUL; content records with a newline (a file name with a newline would split: ignored)
  const sep = q.mode === 'name' ? '\0' : '\n'
  return new Promise(resolve => {
    const hits: SearchHit[] = []
    let rest = ''
    let errOut = ''
    let truncated = false
    const child = spawn(cmd, args, { cwd, signal })
    const add = (rec: string) => {
      const hit = hitOf(rec, match)
      if (!hit) return
      if (hits.length === max) return void ((truncated = true), child.kill())
      hits.push(hit)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      const recs = (rest + d).split(sep)
      rest = recs.pop()!
      for (const r of recs) if (!truncated && r) add(r)
    })
    child.stderr.on('data', d => (errOut += d))
    child.on('error', err => (err.name === 'AbortError' ? resolve({ hits: [], truncated: false, error: null }) : resolve({ hits, truncated, error: err.message })))
    child.on('close', code => {
      if (signal?.aborted) return resolve({ hits: [], truncated: false, error: null })
      if (rest && !truncated) add(rest)
      // grep and git grep exit 1 for "no match"; 2 and up is a real error (e.g. a broken regex)
      const failed = !truncated && code !== null && code > 1
      resolve({ hits, truncated, error: failed ? errOut.trim() || `${cmd} è terminato con codice ${code}` : null })
    })
  })
}

// The same search on an ssh host: git grep / git ls-files inside a repository, else grep and find.
// The output comes back whole, so a search matching too much stops at the buffer limit and says so.
export async function runSearchRemote(host: string, cwd: string, q: SearchQuery, max = 1000, signal?: AbortSignal): Promise<SearchResult> {
  const sh = ([cmd, args]: [string, string[]]) => [cmd, ...args].map(shQuote).join(' ')
  const script =
    `cd -- ${shQuote(cwd)} && { if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; ` +
    `then ${sh(command(q, true))}; else ${sh(command(q, false))}; fi; c=$?; [ $c -le 1 ] || exit $c; }` // 1 = no match, not an error
  const r = await sshRun(host, script, { timeout: 60_000, signal })
  if (signal?.aborted) return { hits: [], truncated: false, error: null }
  if (!r.ok) return { hits: [], truncated: false, error: /maxBuffer/i.test(r.error) ? 'Troppi risultati: restringi la ricerca' : r.error }
  const match = q.mode === 'name' ? nameMatcher(q.text) : null
  const hits: SearchHit[] = []
  for (const rec of r.out.toString('utf8').split(q.mode === 'name' ? '\0' : '\n')) {
    const hit = rec && hitOf(rec, match)
    if (!hit) continue
    if (hits.length === max) return { hits, truncated: true, error: null }
    hits.push(hit)
  }
  return { hits, truncated: false, error: null }
}

// Every file of the project around `cwd`, for quick open: from the repository's root when inside one
// (tracked and untracked, ignored ones left out), else below `cwd` without .git and node_modules.
export async function listFiles(cwd: string, max = 20_000): Promise<{ root: string; files: string[]; truncated: boolean }> {
  const top = await new Promise<string | null>(ok => execFile('git', ['rev-parse', '--show-toplevel'], { cwd, timeout: 5000 }, (err, out) => ok(err ? null : out.trim())))
  const root = top ?? cwd
  const [cmd, args] = command({ text: '', mode: 'name', regex: false, word: false }, !!top)
  return new Promise(resolve => {
    const files: string[] = []
    let rest = ''
    let truncated = false
    const child = spawn(cmd, args, { cwd: root })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      const recs = (rest + d).split('\0')
      rest = recs.pop()!
      for (const r of recs) {
        if (!r) continue
        if (files.length === max) return void ((truncated = true), child.kill())
        files.push(r.replace(/^\.\//, ''))
      }
    })
    child.on('error', () => resolve({ root, files, truncated }))
    child.on('close', () => resolve({ root, files, truncated }))
  })
}
