import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { isValidRefName } from '../shared/refName'
import type { Changes, Commit, CommitInfo, DiffSpec, DiffTexts, FileChange, GitAction, GitOperation, GitRefs, GitResult, GitStatus, LogView, Ref, Worktree } from '../shared/types'
import { readLocal } from './files'
import { t } from '../shared/i18n'

const FORMAT = '%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s'

export function parseLog(text: string, remotes: string[] = ['origin']): Commit[] {
  return text
    .split('\n')
    .filter(Boolean)
    .map(l => {
      const [sha, parents, author, time, refs, ...subject] = l.split('\x1f')
      return { sha, parents: parents ? parents.split(' ') : [], author, time: Number(time), subject: subject.join('\x1f'), refs: parseRefs(refs, remotes) }
    })
}

function parseRefs(d: string, remotes: string[]): Ref[] {
  if (!d) return []
  return d.split(', ').flatMap((r): Ref[] => {
    if (r === 'HEAD') return [{ name: 'HEAD', kind: 'head' }] // detached
    if (r.startsWith('HEAD -> ')) return [{ name: r.slice(8), kind: 'head' }]
    if (r.startsWith('tag: ')) return [{ name: r.slice(5), kind: 'tag' }]
    if (r.endsWith('/HEAD')) return [] // origin/HEAD
    return [{ name: r, kind: remotes.some(x => r.startsWith(x + '/')) ? 'remote' : 'branch' }]
  })
}

// rejects anything git could read as an option or that is not a plain ref name
function ref(name: string): string {
  if (!isValidRefName(name)) throw new Error(t('Nome non valido: "{name}"', { name }))
  return name
}

// file paths always go after "--", so none is read as an option; an empty list would mean "everything"
function paths(p: string[]): string[] {
  if (!p.length) throw new Error(t('Nessun file'))
  return ['--', ...p]
}

const stash = (i: number) => {
  if (!Number.isInteger(i) || i < 0) throw new Error(t('Stash non valido: {i}', { i }))
  return `stash@{${i}}`
}

export function buildGitArgs(a: GitAction): string[] {
  switch (a.op) {
    case 'fetch':
      return ['fetch', '--all', '--prune']
    case 'pull':
      return ['pull']
    case 'push':
      return a.setUpstream ? ['push', '-u', ref(a.remote), 'HEAD'] : ['push']
    case 'checkout':
      return ['switch', ref(a.branch)]
    case 'merge':
      return ['merge', '--no-edit', ref(a.ref)]
    case 'rebase':
      return ['rebase', ref(a.onto)]
    case 'abort':
      return [a.what, '--abort']
    case 'continue':
      return [a.what, '--continue'] // GIT_EDITOR=true (gitEnv) keeps the message git proposes
    case 'pushBranch':
      return ['push', '-u', ref(a.remote), ref(a.branch)]
    case 'branch':
      return a.checkout ? ['switch', '-c', ref(a.name), ref(a.sha)] : ['branch', ref(a.name), ref(a.sha)]
    case 'deleteBranch':
      return ['branch', a.force ? '-D' : '-d', ref(a.name)]
    case 'deleteRemoteBranch':
      return ['push', ref(a.remote), '--delete', ref(a.name)]
    case 'renameBranch':
      return ['branch', '-m', ref(a.from), ref(a.to)]
    case 'cherryPick':
      return ['cherry-pick', ref(a.sha)]
    case 'revert':
      return ['revert', '--no-edit', ref(a.sha)]
    case 'reset':
      return ['reset', `--${a.mode}`, ref(a.sha)]
    case 'stage':
      return ['add', ...paths(a.paths)]
    case 'unstage':
      return ['reset', '-q', ...paths(a.paths)] // unlike restore --staged, also works before the first commit
    case 'discard':
      return a.untracked ? ['clean', '-f', ...paths(a.paths)] : ['restore', '--worktree', ...paths(a.paths)]
    case 'commit':
      return ['commit', ...(a.amend ? ['--amend'] : []), '-m', a.message]
    case 'stash':
      return ['stash', 'push', '-u', ...(a.message ? ['-m', a.message] : [])]
    case 'stashPop':
      return ['stash', 'pop', stash(a.index)]
    case 'stashApply':
      return ['stash', 'apply', stash(a.index)]
    case 'stashDrop':
      return ['stash', 'drop', stash(a.index)]
    case 'worktreeRemove':
      return ['worktree', 'remove', ...(a.force ? ['--force'] : []), '--', a.path]
    case 'tag':
      return a.message ? ['tag', '-a', ref(a.name), '-m', a.message, ref(a.sha)] : ['tag', ref(a.name), ref(a.sha)]
    case 'pushTag':
      return ['push', ref(a.remote), `refs/tags/${ref(a.name)}`]
  }
}

// git must fail instead of waiting for a password nobody can type (ssh can't prompt either: see `detached` below),
// and background status must not hold .git/index.lock while a terminal next to us commits
export function gitEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined) out[k] = v
  out.GIT_TERMINAL_PROMPT = '0'
  out.GIT_OPTIONAL_LOCKS = '0'
  out.GIT_EDITOR = 'true' // a continued rebase or cherry-pick keeps its message instead of waiting for an editor
  return out
}

const NETWORK = new Set(['fetch', 'pull', 'push', 'pushTag', 'pushBranch', 'deleteRemoteBranch'])

interface Out extends GitResult {
  stdout: string // parse this only: stderr may carry warnings
  raw: string // stdout untrimmed, for file contents
  noGit?: boolean // the git binary is not installed
}

function git(cwd: string, args: string[], timeout = 20_000): Promise<Out> {
  return new Promise(resolve => {
    // detached = own session without a controlling terminal, so ssh fails instead of asking for a passphrase
    // (execFile ignores `detached`, spawn honours it)
    const c = spawn('git', args, { cwd, env: gitEnv(process.env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    // decode as a stream: a character split across two chunks stays whole
    c.stdout.setEncoding('utf8')
    c.stderr.setEncoding('utf8')
    c.stdout.on('data', d => (stdout += d))
    c.stderr.on('data', d => (stderr += d))
    const timer = setTimeout(() => c.kill(), timeout)
    const done = (ok: boolean, extra = '', noGit = false) => {
      clearTimeout(timer)
      resolve({ ok, stdout: stdout.trim(), raw: stdout, output: (stdout + stderr + extra).trim(), noGit })
    }
    // ENOENT with an existing cwd: the binary is missing (a missing cwd gives the same code)
    c.on('error', e => done(false, e.message, (e as NodeJS.ErrnoException).code === 'ENOENT' && existsSync(cwd)))
    c.on('close', code => done(code === 0))
  })
}

// what the graph shows: one ref alone (solo), or everything but the hidden refs (full refnames)
export function logArgs(v: LogView, head: boolean): string[] {
  const args = ['log', '--topo-order', '-n', String(v.limit), `--format=${FORMAT}`]
  if (v.solo) return [...args, '--end-of-options', v.solo] // it comes from saved state: never an option
  const ex = (prefix: string) => v.hidden.filter(r => r.startsWith(prefix)).map(r => `--exclude=${r.slice(prefix.length)}`)
  // --exclude applies to the --branches/--remotes right after it; no stash or tool refs; HEAD for a detached checkout
  return [...args, ...ex('refs/heads/'), '--branches', ...ex('refs/remotes/'), '--remotes', '--tags', ...(head ? ['HEAD'] : [])]
}

export async function gitLog(cwd: string, v: LogView): Promise<Commit[]> {
  const [branch, remotes] = await Promise.all([git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']), git(cwd, ['remote'])])
  // HEAD would bring a hidden checked-out branch back into the graph
  const head = !(branch.ok && v.hidden.includes(`refs/heads/${branch.stdout}`))
  const withHead = await git(cwd, logArgs(v, head))
  const r = withHead.ok || !head ? withHead : await git(cwd, logArgs(v, false)) // unborn HEAD
  return r.ok ? parseLog(r.stdout, lines(remotes.stdout)) : [] // empty repository: no commits yet
}

export async function gitStatus(cwd: string): Promise<GitStatus> {
  const none: GitStatus = { repo: false, branch: null, upstream: null, remote: null, ahead: 0, behind: 0, changes: 0, operation: null, conflicts: [] }
  const inside = await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (inside.noGit) return { ...none, error: 'no-git' }
  if (inside.stdout !== 'true') return { ...none, error: 'not-repo' } // also bare repos
  const [branch, upstream, porcelain, operation, conflicts, remotes] = await Promise.all([
    git(cwd, ['symbolic-ref', '--short', '-q', 'HEAD']),
    git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    git(cwd, ['status', '--porcelain']),
    stoppedOperation(cwd),
    git(cwd, ['diff', '--name-only', '--diff-filter=U']),
    git(cwd, ['remote'])
  ])
  const remoteList = lines(remotes.stdout)
  let ahead = 0
  let behind = 0
  if (upstream.ok) {
    const c = await git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
    if (c.ok) [behind, ahead] = c.stdout.split(/\s+/).map(Number)
  }
  return {
    repo: true,
    branch: branch.ok ? branch.stdout : null,
    upstream: upstream.ok ? upstream.stdout : null,
    remote: upstream.ok ? upstream.stdout.split('/')[0] : remoteList.includes('origin') ? 'origin' : (remoteList[0] ?? null),
    ahead,
    behind,
    changes: porcelain.ok ? lines(porcelain.stdout).length : 0,
    operation,
    conflicts: conflicts.ok ? lines(conflicts.stdout) : []
  }
}

// what git left halfway, by the files it keeps while waiting (a rebase also leaves REVERT_HEAD-like refs, so it goes first)
async function stoppedOperation(cwd: string): Promise<GitOperation | null> {
  const where = await git(cwd, ['rev-parse', '--git-path', 'rebase-merge', '--git-path', 'rebase-apply', '--git-path', 'MERGE_HEAD', '--git-path', 'CHERRY_PICK_HEAD', '--git-path', 'REVERT_HEAD'])
  if (!where.ok) return null
  const [rm, ra, merge, pick, revert] = lines(where.stdout).map(p => existsSync(resolve(cwd, p)))
  return rm || ra ? 'rebase' : merge ? 'merge' : pick ? 'cherry-pick' : revert ? 'revert' : null
}

// `git status --porcelain=v1 -z`: "XY path", and for a rename or copy the old path as the next field
export function parsePorcelain(text: string): Changes {
  const out: Changes = { staged: [], unstaged: [] }
  const f = text.split('\0')
  for (let i = 0; i < f.length; i++) {
    const [x, y, path] = [f[i][0], f[i][1], f[i].slice(3)]
    if (!path) continue
    const oldPath = x === 'R' || x === 'C' ? f[++i] : undefined
    if (x === '?') out.unstaged.push({ path, status: '?' })
    else if (x === 'U' || y === 'U' || (x === y && (x === 'A' || x === 'D'))) out.unstaged.push({ path, status: 'U' }) // both sides changed it: a conflict
    else {
      if (x !== ' ') out.staged.push({ path, status: x, ...(oldPath ? { oldPath } : {}) })
      if (y !== ' ') out.unstaged.push({ path, status: y })
    }
  }
  return out
}

export async function gitChanges(cwd: string): Promise<Changes> {
  const r = await git(cwd, ['status', '--porcelain=v1', '-z', '-uall'])
  return r.ok ? parsePorcelain(r.raw) : { staged: [], unstaged: [] } // raw: the first line may start with a space
}

// `git diff-tree --name-status -z`: the status, then one path (two for renames and copies)
export function parseNameStatus(text: string): FileChange[] {
  const f = text.split('\0').filter(Boolean)
  const out: FileChange[] = []
  for (let i = 0; i < f.length; i++) {
    const status = f[i][0]
    if (status === 'R' || status === 'C') out.push({ status, oldPath: f[++i], path: f[++i] })
    else out.push({ status, path: f[++i] })
  }
  return out
}

export async function gitCommitInfo(cwd: string, sha: string): Promise<CommitInfo | null> {
  try {
    ref(sha)
  } catch {
    return null
  }
  const meta = await git(cwd, ['show', '-s', '--format=%P%x1f%an%x1f%at%x1f%ae%x1f%B', sha])
  if (!meta.ok) return null
  const [parents, author, time, email, ...message] = meta.stdout.split('\x1f')
  // against the first parent, named: diff-tree ignores --first-parent and would list a merge's (or a stash's) other parents too
  const [first, , third] = parents.split(' ')
  const files = await git(cwd, ['diff-tree', '-r', '-z', '--name-status', '-M', ...(first ? [first, sha] : ['--root', '--no-commit-id', sha])])
  const list = files.ok ? parseNameStatus(files.stdout) : []
  // a stash made with -u keeps the untracked files in a third parent, a root commit of their own
  if (third && (await git(cwd, ['show', '-s', '--format=%s', third])).stdout.startsWith('untracked files on ')) {
    const u = await git(cwd, ['diff-tree', '-r', '-z', '--name-status', '--root', '--no-commit-id', third])
    if (u.ok) list.push(...parseNameStatus(u.stdout).map(f => ({ ...f, status: '?', from: third })))
  }
  return { sha, author, email, time: Number(time), message: message.join('\x1f').trim(), files: list }
}

export async function gitRefs(cwd: string): Promise<GitRefs> {
  const [refs, remotes, stashes] = await Promise.all([
    git(cwd, ['for-each-ref', '--sort=-creatordate', '--format=%(refname)%1f%(objectname)%1f%(*objectname)%1f%(upstream:short)%1f%(upstream:track)', 'refs/heads', 'refs/remotes', 'refs/tags']),
    git(cwd, ['remote']),
    git(cwd, ['stash', 'list', '--format=%gd%x1f%H%x1f%s'])
  ])
  const out: GitRefs = { branches: [], remoteBranches: [], tags: [], remotes: lines(remotes.stdout), stashes: [], worktrees: (await gitWorktrees(cwd)).slice(1) }
  for (const l of lines(refs.stdout)) {
    const [full, sha, peeled, upstream, track] = l.split('\x1f')
    if (full.startsWith('refs/heads/')) out.branches.push({ name: full.slice(11), sha, upstream: upstream || null, track })
    else if (full.startsWith('refs/remotes/') && !full.endsWith('/HEAD')) out.remoteBranches.push({ name: full.slice(13), sha })
    else if (full.startsWith('refs/tags/')) out.tags.push({ name: full.slice(10), sha: peeled || sha }) // an annotated tag points at its commit
  }
  for (const l of lines(stashes.stdout)) {
    const [name, sha, message] = l.split('\x1f')
    out.stashes.push({ index: Number(/\{(\d+)\}/.exec(name)?.[1]), sha, message })
  }
  return out
}

// a blob as text, '' when the file is not there on that side (added, deleted, root commit), null when binary
async function blob(cwd: string, spec: string): Promise<string | null> {
  const r = await git(cwd, ['show', spec])
  if (!r.ok) return ''
  return r.raw.includes('\0') ? null : r.raw
}

export async function gitDiffTexts(cwd: string, d: DiffSpec): Promise<DiffTexts> {
  let original: string | null
  let modified: string | null
  try {
    if (d.kind === 'commit') {
      ref(d.sha)
      ;[original, modified] = await Promise.all([blob(cwd, `${d.sha}^:${d.oldPath ?? d.path}`), blob(cwd, `${d.sha}:${d.path}`)])
    } else if (d.kind === 'staged') {
      ;[original, modified] = await Promise.all([blob(cwd, `HEAD:${d.oldPath ?? d.path}`), blob(cwd, `:${d.path}`)])
    } else {
      const work = await readLocal(resolve(cwd, d.path))
      ;[original, modified] = [await blob(cwd, `:${d.path}`), work.ok ? work.text : 'binary' in work && work.binary ? null : '']
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
  if (original === null || modified === null) return { ok: false, error: t('File binario') }
  return { ok: true, original, modified }
}

const lines = (s: string) => s.split('\n').filter(Boolean)

export async function gitRun(cwd: string, a: GitAction): Promise<GitResult> {
  let args: string[]
  try {
    args = buildGitArgs(a)
  } catch (e) {
    return { ok: false, output: (e as Error).message }
  }
  const { ok, output } = await git(cwd, args, NETWORK.has(a.op) ? 120_000 : 20_000)
  return { ok, output }
}

// `git worktree list --porcelain`: blocks of "worktree <path>", "HEAD <sha>", "branch refs/heads/<name>" or "detached";
// the first block is the main checkout
export function parseWorktrees(text: string): Worktree[] {
  return text
    .split('\n\n')
    .map(b => Object.fromEntries(lines(b).map(l => [l.split(' ')[0], l.slice(l.indexOf(' ') + 1)])))
    .filter(f => f.worktree && !('bare' in f))
    .map(f => ({ path: f.worktree, sha: f.HEAD ?? '', branch: f.branch ? f.branch.replace(/^refs\/heads\//, '') : null }))
}

export async function gitWorktrees(cwd: string): Promise<Worktree[]> {
  const r = await git(cwd, ['worktree', 'list', '--porcelain'])
  return r.ok ? parseWorktrees(r.raw) : []
}
