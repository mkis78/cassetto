import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { t } from '../src/shared/i18n'
import { describe, expect, test } from 'vitest'
import { buildGitArgs, logArgs, gitWorktrees, parseWorktrees, gitChanges, gitCommitInfo, gitDiffTexts, gitEnv, gitLog, gitRefs, gitRun, gitStatus, parseLog, parseNameStatus, parsePorcelain } from '../src/main/git'

const US = '\x1f'
const ALL = { solo: null, hidden: [], limit: 500 }
const line = (...f: string[]) => f.join(US)

describe('parseLog', () => {
  test('reads refs: head, branch, remote, tag; a detached HEAD is marked', () => {
    const [c] = parseLog(line('a1', 'p1 p2', 'Ann', '100', 'HEAD -> main, origin/main, feat, tag: v1.0', 'merge feat') + '\n')
    expect(c).toEqual({
      sha: 'a1', parents: ['p1', 'p2'], author: 'Ann', time: 100, subject: 'merge feat',
      refs: [{ name: 'main', kind: 'head' }, { name: 'origin/main', kind: 'remote' }, { name: 'feat', kind: 'branch' }, { name: 'v1.0', kind: 'tag' }]
    })
    expect(parseLog(line('b', '', 'X', '1', 'HEAD, tag: v2', 's'))[0].refs).toEqual([{ name: 'HEAD', kind: 'head' }, { name: 'v2', kind: 'tag' }])
    expect(parseLog(line('c', '', 'X', '1', '', 'root'))[0].parents).toEqual([])
  })

  test('remotes come from the repository, not from fixed names', () => {
    const [c] = parseLog(line('a', '', 'X', '1', 'gitlab/main, origin/x', 's'), ['gitlab'])
    expect(c.refs).toEqual([{ name: 'gitlab/main', kind: 'remote' }, { name: 'origin/x', kind: 'branch' }])
  })

  test('subject may contain the separator-free text with special chars', () => {
    expect(parseLog(line('d', 'e', 'X', '1', '', 'fix: a -> b, c'))[0].subject).toBe('fix: a -> b, c')
  })
})

describe('buildGitArgs', () => {
  test('maps every action', () => {
    expect(buildGitArgs({ op: 'fetch' })).toEqual(['fetch', '--all', '--prune'])
    expect(buildGitArgs({ op: 'pull' })).toEqual(['pull'])
    expect(buildGitArgs({ op: 'push', setUpstream: false, remote: 'origin' })).toEqual(['push'])
    expect(buildGitArgs({ op: 'push', setUpstream: true, remote: 'gitlab' })).toEqual(['push', '-u', 'gitlab', 'HEAD'])
    expect(buildGitArgs({ op: 'checkout', branch: 'feat/x' })).toEqual(['switch', 'feat/x'])
    expect(buildGitArgs({ op: 'merge', ref: 'origin/feat' })).toEqual(['merge', '--no-edit', 'origin/feat'])
    expect(buildGitArgs({ op: 'abort', what: 'rebase' })).toEqual(['rebase', '--abort'])
    expect(buildGitArgs({ op: 'continue', what: 'cherry-pick' })).toEqual(['cherry-pick', '--continue'])
    expect(buildGitArgs({ op: 'rebase', onto: 'main' })).toEqual(['rebase', 'main'])
    expect(buildGitArgs({ op: 'pushBranch', branch: 'feat', remote: 'origin' })).toEqual(['push', '-u', 'origin', 'feat'])
    expect(buildGitArgs({ op: 'branch', name: 'fix', sha: 'abc', checkout: true })).toEqual(['switch', '-c', 'fix', 'abc'])
    expect(buildGitArgs({ op: 'branch', name: 'fix', sha: 'abc', checkout: false })).toEqual(['branch', 'fix', 'abc'])
    expect(buildGitArgs({ op: 'deleteBranch', name: 'fix', force: true })).toEqual(['branch', '-D', 'fix'])
    expect(buildGitArgs({ op: 'deleteRemoteBranch', remote: 'origin', name: 'fix' })).toEqual(['push', 'origin', '--delete', 'fix'])
    expect(buildGitArgs({ op: 'renameBranch', from: 'a', to: 'b' })).toEqual(['branch', '-m', 'a', 'b'])
    expect(buildGitArgs({ op: 'cherryPick', sha: 'abc' })).toEqual(['cherry-pick', 'abc'])
    expect(buildGitArgs({ op: 'revert', sha: 'abc' })).toEqual(['revert', '--no-edit', 'abc'])
    expect(buildGitArgs({ op: 'reset', sha: 'abc', mode: 'hard' })).toEqual(['reset', '--hard', 'abc'])
    expect(buildGitArgs({ op: 'stage', paths: ['-rf', 'a b'] })).toEqual(['add', '--', '-rf', 'a b'])
    expect(buildGitArgs({ op: 'unstage', paths: ['x'] })).toEqual(['reset', '-q', '--', 'x'])
    expect(buildGitArgs({ op: 'discard', paths: ['x'], untracked: false })).toEqual(['restore', '--worktree', '--', 'x'])
    expect(buildGitArgs({ op: 'discard', paths: ['x'], untracked: true })).toEqual(['clean', '-f', '--', 'x'])
    expect(buildGitArgs({ op: 'commit', message: 'm', amend: true })).toEqual(['commit', '--amend', '-m', 'm'])
    expect(buildGitArgs({ op: 'stash', message: null })).toEqual(['stash', 'push', '-u'])
    expect(buildGitArgs({ op: 'stashPop', index: 2 })).toEqual(['stash', 'pop', 'stash@{2}'])
    expect(buildGitArgs({ op: 'tag', name: 'v1', sha: 'abc', message: null })).toEqual(['tag', 'v1', 'abc'])
    expect(buildGitArgs({ op: 'tag', name: 'v1', sha: 'abc', message: 'rel' })).toEqual(['tag', '-a', 'v1', '-m', 'rel', 'abc'])
    expect(buildGitArgs({ op: 'pushTag', name: 'v1', remote: 'gitlab' })).toEqual(['push', 'gitlab', 'refs/tags/v1'])
    expect(() => buildGitArgs({ op: 'pushTag', name: 'v1', remote: '--exec=x' })).toThrow()
  })

  test('rejects names that could be options or are not valid refs', () => {
    for (const bad of ['-x', '--upload-pack=evil', 'a b', 'a..b', 'a~1', '']) {
      expect(() => buildGitArgs({ op: 'tag', name: bad, sha: 'abc', message: null })).toThrow()
      expect(() => buildGitArgs({ op: 'merge', ref: bad })).toThrow()
    }
    expect(() => buildGitArgs({ op: 'tag', name: 'v1', sha: '-x', message: null })).toThrow()
    expect(() => buildGitArgs({ op: 'stage', paths: [] })).toThrow() // "git add --" alone would mean nothing, others "everything"
    expect(() => buildGitArgs({ op: 'stashDrop', index: -1 })).toThrow()
    expect(() => buildGitArgs({ op: 'reset', sha: '--hard', mode: 'soft' })).toThrow()
  })
})

test('porcelain: staged, unstaged, both, renames, untracked and conflicts', () => {
  const z = (...r: string[]) => r.join('\0') + '\0'
  expect(parsePorcelain(z('MM both.ts', 'A  new.ts', ' D gone.ts', 'R  to.ts', 'from.ts', '?? tmp/x.log', 'UU clash.ts', 'AA added-twice.ts'))).toEqual({
    staged: [{ path: 'both.ts', status: 'M' }, { path: 'new.ts', status: 'A' }, { path: 'to.ts', status: 'R', oldPath: 'from.ts' }],
    unstaged: [{ path: 'both.ts', status: 'M' }, { path: 'gone.ts', status: 'D' }, { path: 'tmp/x.log', status: '?' }, { path: 'clash.ts', status: 'U' }, { path: 'added-twice.ts', status: 'U' }]
  })
  expect(parsePorcelain('')).toEqual({ staged: [], unstaged: [] })
})

test('name-status: renames carry both paths', () => {
  expect(parseNameStatus('M\0a.ts\0R100\0old.ts\0new.ts\0D\0b b.ts\0')).toEqual([
    { status: 'M', path: 'a.ts' }, { status: 'R', oldPath: 'old.ts', path: 'new.ts' }, { status: 'D', path: 'b b.ts' }
  ])
})

test('worktree list: main first, branches without refs/heads, detached', () => {
  const text = 'worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r-worktrees/feat-x\nHEAD bbb\nbranch refs/heads/feat/x\n\nworktree /tmp/d\nHEAD ccc\ndetached\n'
  expect(parseWorktrees(text)).toEqual([
    { path: '/r', sha: 'aaa', branch: 'main' },
    { path: '/r-worktrees/feat-x', sha: 'bbb', branch: 'feat/x' },
    { path: '/tmp/d', sha: 'ccc', branch: null }
  ])
})

test('gitEnv never prompts, takes no optional locks and leaves the ssh setup to the user', () => {
  expect(gitEnv({ PATH: '/bin' })).toEqual({ PATH: '/bin', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_EDITOR: 'true' })
  expect(gitEnv({ GIT_SSH_COMMAND: 'ssh -i k' }).GIT_SSH_COMMAND).toBe('ssh -i k')
})

describe('logArgs', () => {
  const base = { solo: null, hidden: [], limit: 500 }
  const tail = (a: string[]) => a.slice(a.findIndex(x => x.startsWith('--format=')) + 1)
  test('default: all branches, remotes, tags and HEAD', () => {
    expect(tail(logArgs(base, true))).toEqual(['--branches', '--remotes', '--tags', 'HEAD'])
    expect(logArgs({ ...base, limit: 1000 }, true)).toContain('1000')
  })
  test('hidden refs are excluded from their own family', () => {
    expect(tail(logArgs({ ...base, hidden: ['refs/heads/feat/x', 'refs/remotes/origin/old'] }, false)))
      .toEqual(['--exclude=feat/x', '--branches', '--exclude=origin/old', '--remotes', '--tags'])
  })
  test('solo shows one ref only', () => {
    expect(tail(logArgs({ ...base, solo: 'refs/heads/feat', hidden: ['refs/heads/x'] }, true))).toEqual(['--end-of-options', 'refs/heads/feat'])
  })
})

describe('on a real repository', () => {
  const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' } })
  const repo = () => {
    const d = mkdtempSync(join(tmpdir(), 'repo è '))
    g(d, 'init', '-q', '-b', 'main')
    // annotated tags made by the app need an identity; CI runners have no global one
    g(d, 'config', 'user.name', 'T')
    g(d, 'config', 'user.email', 't@t')
    return d
  }
  const commit = (d: string, file: string, text: string, msg: string) => (writeFileSync(join(d, file), text), g(d, 'add', '.'), g(d, 'commit', '-qm', msg))

  test('push remote: upstream remote, else origin, else the only remote', async () => {
    const d = repo()
    commit(d, 'f.txt', 'x\n', 'x')
    expect((await gitStatus(d)).remote).toBe(null)
    g(d, 'remote', 'add', 'gitlab', '../nowhere.git')
    expect((await gitStatus(d)).remote).toBe('gitlab')
  })

  test('hiding the checked-out branch hides it, HEAD does not bring it back', async () => {
    const d = repo()
    commit(d, 'f.txt', 'x\n', 'base')
    g(d, 'checkout', '-qb', 'side')
    commit(d, 'f.txt', 'y\n', 'only on side')
    const subjects = async (hidden: string[]) => (await gitLog(d, { ...ALL, hidden })).map(c => c.subject)
    expect(await subjects([])).toContain('only on side')
    expect(await subjects(['refs/heads/side'])).toEqual(['base'])
  })

  test('a solo that is not a ref never reaches git as an option', async () => {
    const d = repo()
    commit(d, 'f.txt', 'x\n', 'base')
    const out = join(d, 'pwned.txt')
    expect(await gitLog(d, { ...ALL, solo: `--output=${out}` })).toEqual([])
    expect(existsSync(out)).toBe(false)
  })

  test('tags come newest first', async () => {
    const d = repo()
    const at = (date: string, ...a: string[]) => execFileSync('git', a, { cwd: d, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } })
    writeFileSync(join(d, 'f.txt'), '1\n')
    g(d, 'add', '.')
    at('2020-01-01T00:00:00Z', 'commit', '-qm', 'one')
    g(d, 'tag', 'v1')
    writeFileSync(join(d, 'f.txt'), '2\n')
    g(d, 'add', '.')
    at('2021-01-01T00:00:00Z', 'commit', '-qm', 'two')
    g(d, 'tag', 'v2')
    expect((await gitRefs(d)).tags.map(t => t.name)).toEqual(['v2', 'v1'])
  })

  test('stash commits and refs stay out of the graph', async () => {
    const d = repo()
    commit(d, 'f.txt', 'x\n', 'x')
    writeFileSync(join(d, 'f.txt'), 'dirty\n')
    g(d, 'stash', '-q')
    const log = await gitLog(d, ALL)
    expect(log).toHaveLength(1)
    expect(log[0].refs).toEqual([{ name: 'main', kind: 'head' }])
  })

  test('a bare repository is not a working tree', async () => {
    const d = mkdtempSync(join(tmpdir(), 'tbare-'))
    g(d, 'init', '-q', '--bare')
    expect((await gitStatus(d)).repo).toBe(false)
  })

  test('not a repository', async () => {
    const st = await gitStatus(mkdtempSync(join(tmpdir(), 'tnogit-')))
    expect(st.repo).toBe(false)
    expect(st.error).toBe('not-repo')
  })

  test('empty repository', async () => {
    const d = repo()
    expect(await gitLog(d, ALL)).toEqual([])
    const s = await gitStatus(d)
    expect(s.repo).toBe(true)
    expect(s.branch).toBe('main')
  })

  test('log with merge, tag, conflict and abort', async () => {
    const d = repo()
    commit(d, 'f.txt', 'base\n', 'base')
    g(d, 'switch', '-qc', 'feat')
    commit(d, 'g.txt', 'feat\n', 'feat work')
    g(d, 'switch', '-q', 'main')
    commit(d, 'h.txt', 'main\n', 'main work')
    g(d, 'merge', '-q', '--no-edit', 'feat')
    const log = await gitLog(d, ALL)
    expect(log).toHaveLength(4)
    expect(log[0].parents).toHaveLength(2)
    expect(log[0].refs).toContainEqual({ name: 'main', kind: 'head' })
    expect((await gitCommitInfo(d, log[0].sha))!.files).toEqual([{ status: 'A', path: 'g.txt' }]) // a merge: what it brought in from feat

    expect((await gitRun(d, { op: 'tag', name: 'v1.0', sha: log[0].sha, message: 'release' })).ok).toBe(true)
    expect((await gitLog(d, ALL))[0].refs).toContainEqual({ name: 'v1.0', kind: 'tag' })

    g(d, 'switch', '-qc', 'clash')
    commit(d, 'f.txt', 'clash\n', 'clash')
    g(d, 'switch', '-q', 'main')
    commit(d, 'f.txt', 'mine\n', 'mine')
    const r = await gitRun(d, { op: 'merge', ref: 'clash' })
    expect(r.ok).toBe(false)
    expect(r.output).toMatch(/CONFLICT|CONFLITT/) // output follows the system language
    const s = await gitStatus(d)
    expect(s.operation).toBe('merge')
    expect(s.conflicts).toEqual(['f.txt'])
    expect((await gitRun(d, { op: 'abort', what: 'merge' })).ok).toBe(true)
    const after = await gitStatus(d)
    expect(after.operation).toBe(null)
    expect(after.changes).toBe(0)
  })

  test('changes, stage, commit, details, diff, refs, stash, rebase', async () => {
    const d = repo()
    commit(d, 'a.txt', 'uno\n', 'first')
    writeFileSync(join(d, 'a.txt'), 'uno\ndue è\n')
    writeFileSync(join(d, 'new.txt'), 'nuovo\n')
    expect(await gitChanges(d)).toEqual({ staged: [], unstaged: [{ path: 'a.txt', status: 'M' }, { path: 'new.txt', status: '?' }] })
    expect(await gitDiffTexts(d, { kind: 'unstaged', path: 'a.txt' })).toEqual({ ok: true, original: 'uno\n', modified: 'uno\ndue è\n' })

    writeFileSync(join(d, 'big.txt'), Buffer.alloc(21 * 1024 * 1024, 97)) // over the editor limit: "too large", not "binary"
    expect(await gitDiffTexts(d, { kind: 'unstaged', path: 'big.txt' })).toEqual({ ok: false, error: t('File troppo grande per il diff') })
    rmSync(join(d, 'big.txt'))
    expect((await gitRun(d, { op: 'stage', paths: ['a.txt', 'new.txt'] })).ok).toBe(true)
    expect((await gitChanges(d)).staged.map(f => f.path)).toEqual(['a.txt', 'new.txt'])
    expect(await gitDiffTexts(d, { kind: 'staged', path: 'new.txt' })).toEqual({ ok: true, original: '', modified: 'nuovo\n' })
    expect((await gitRun(d, { op: 'unstage', paths: ['new.txt'] })).ok).toBe(true)
    expect((await gitRun(d, { op: 'commit', message: 'second\n\nbody', amend: false })).ok).toBe(true)

    const [head] = await gitLog(d, ALL)
    const info = await gitCommitInfo(d, head.sha)
    expect(info).toMatchObject({ author: 'T', email: 't@t', message: 'second\n\nbody', files: [{ status: 'M', path: 'a.txt' }] })
    expect(await gitDiffTexts(d, { kind: 'commit', sha: head.sha, path: 'a.txt' })).toEqual({ ok: true, original: 'uno\n', modified: 'uno\ndue è\n' })
    expect(await gitCommitInfo(d, '--evil')).toBeNull()
    expect((await gitCommitInfo(d, (await gitLog(d, ALL)).at(-1)!.sha))!.files).toEqual([{ status: 'A', path: 'a.txt' }]) // the root commit

    expect((await gitRun(d, { op: 'stash', message: 'wip' })).ok).toBe(true) // takes the untracked new.txt too
    expect((await gitChanges(d)).unstaged).toEqual([])
    const [st] = (await gitRefs(d)).stashes
    expect(st).toMatchObject({ index: 0, message: 'On main: wip' })
    const stashed = (await gitCommitInfo(d, st.sha))!.files
    expect(stashed).toMatchObject([{ path: 'new.txt', status: '?' }]) // untracked: kept in the stash's third parent
    expect(await gitDiffTexts(d, { kind: 'commit', sha: stashed[0].from!, path: 'new.txt' })).toEqual({ ok: true, original: '', modified: 'nuovo\n' })
    expect((await gitRun(d, { op: 'stashPop', index: 0 })).ok).toBe(true)
    expect((await gitChanges(d)).unstaged).toEqual([{ path: 'new.txt', status: '?' }])

    expect((await gitRun(d, { op: 'branch', name: 'feat', sha: head.sha, checkout: true })).ok).toBe(true)
    commit(d, 'f.txt', 'f\n', 'feat work')
    g(d, 'switch', '-q', 'main')
    commit(d, 'm.txt', 'm\n', 'main work')
    g(d, 'tag', '-a', 'v1', '-m', 'rel')
    g(d, 'switch', '-q', 'feat')
    expect((await gitRun(d, { op: 'rebase', onto: 'main' })).ok).toBe(true)
    const refs = await gitRefs(d)
    expect(refs.branches.map(b => b.name).sort()).toEqual(['feat', 'main'])
    expect(refs.tags).toEqual([{ name: 'v1', sha: refs.branches.find(b => b.name === 'main')!.sha }]) // the commit, not the tag object
    expect((await gitLog(d, ALL)).map(c => c.subject)).toEqual(['feat work', 'main work', 'second', 'first'])
  })

  test('a stopped rebase is reported and can be aborted', async () => {
    const d = repo()
    commit(d, 'f.txt', 'base\n', 'base')
    g(d, 'switch', '-qc', 'feat')
    commit(d, 'f.txt', 'feat\n', 'feat')
    g(d, 'switch', '-q', 'main')
    commit(d, 'f.txt', 'main\n', 'main')
    g(d, 'switch', '-q', 'feat')
    expect((await gitRun(d, { op: 'rebase', onto: 'main' })).ok).toBe(false)
    expect((await gitStatus(d)).operation).toBe('rebase')
    expect((await gitChanges(d)).unstaged).toEqual([{ path: 'f.txt', status: 'U' }])
    expect((await gitRun(d, { op: 'abort', what: 'rebase' })).ok).toBe(true)
    expect((await gitStatus(d)).operation).toBe(null)
  })

  test('a worktree is listed and removed (force when it holds untracked work)', async () => {
    const d = realpathSync(repo())
    commit(d, 'a.txt', 'a\n', 'first')
    const wt = `${d}-wt`
    g(d, 'worktree', 'add', '-q', '-b', 'claude/task-1', '--', wt)
    expect((await gitRefs(d)).worktrees).toMatchObject([{ path: wt, branch: 'claude/task-1' }])
    writeFileSync(join(wt, 'wip.txt'), 'x\n')
    expect((await gitRun(d, { op: 'worktreeRemove', path: wt, force: false })).ok).toBe(false)
    expect((await gitRun(d, { op: 'worktreeRemove', path: wt, force: true })).ok).toBe(true)
    expect((await gitWorktrees(d)).map(w => w.branch)).toEqual(['main'])
  })

  test('a branch with a slash is listed and can be checked out', async () => {
    const d = repo()
    commit(d, 'a.txt', 'a\n', 'first')
    g(d, 'branch', 'feat/x')
    expect((await gitRefs(d)).branches.map(b => b.name)).toContain('feat/x')
    expect((await gitRun(d, { op: 'checkout', branch: 'feat/x' })).ok).toBe(true)
    expect((await gitStatus(d)).branch).toBe('feat/x')
  })

  test('git missing: status resolves to no-git', async () => {
    const path = process.env.PATH
    process.env.PATH = ''
    try {
      expect(await gitStatus(tmpdir())).toMatchObject({ repo: false, error: 'no-git' })
    } finally {
      process.env.PATH = path
    }
  })
})
