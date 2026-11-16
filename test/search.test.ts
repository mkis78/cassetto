import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { listFiles, nameMatcher, parseContentRecord, posixRegex, runSearch } from '../src/main/search'
import type { SearchQuery } from '../src/shared/types'

const q = (text: string, o: Partial<SearchQuery> = {}): SearchQuery => ({ text, mode: 'content', regex: false, word: false, ...o })

// a folder with code, an ignored node_modules and an untracked file; `git` makes it a repository
function project(git: boolean): string {
  const d = mkdtempSync(join(tmpdir(), 'tsearch-'))
  mkdirSync(join(d, 'src/deep'), { recursive: true })
  mkdirSync(join(d, 'node_modules/lib'), { recursive: true })
  writeFileSync(join(d, 'src/app.ts'), 'import { parseLog } from "./git"\nconst x = parseLog(a: b)\nrerun()\n')
  writeFileSync(join(d, 'src/deep/My Tile.tsx'), 'export function GitTile() { run() }\n')
  writeFileSync(join(d, 'node_modules/lib/index.js'), 'parseLog()\n')
  writeFileSync(join(d, 'README.md'), 'PARSELOG in caps\n')
  writeFileSync(join(d, '.gitignore'), 'node_modules\n')
  if (git) {
    const g = (...a: string[]) => execFileSync('git', a, { cwd: d })
    g('init', '-q')
    g('add', 'src', '.gitignore')
    writeFileSync(join(d, 'src/new.ts'), 'parseLog() // untracked\n')
  } else writeFileSync(join(d, 'src/new.ts'), 'parseLog() // untracked\n')
  return d
}

describe.each([true, false])('content search (git repository: %s)', git => {
  const d = project(git)

  test('finds lines, skips ignored folders, includes files not committed yet', async () => {
    const r = await runSearch(d, q('parseLog'))
    expect(r.error).toBeNull()
    // "parseLog" has a capital, so it matches case exactly and skips README's PARSELOG
    expect(r.hits.map(h => `${h.path}:${h.line}`).sort()).toEqual(['src/app.ts:1', 'src/app.ts:2', 'src/new.ts:1'])
    expect(r.hits.find(h => h.path === 'src/app.ts' && h.line === 2)!.text).toBe('const x = parseLog(a: b)')
  })

  test('case matters only when the query has a capital letter', async () => {
    expect((await runSearch(d, q('parselog'))).hits).toHaveLength(4)
    expect((await runSearch(d, q('PARSELOG'))).hits.map(h => h.path)).toEqual(['README.md'])
  })

  test('plain text by default, regex on request, whole word', async () => {
    expect((await runSearch(d, q('parseLog(a'))).hits).toHaveLength(1)
    expect((await runSearch(d, q('function \\w+Tile', { regex: true }))).hits.map(h => h.path)).toEqual(['src/deep/My Tile.tsx'])
    expect((await runSearch(d, q('\\d\\s*$', { regex: true }))).hits).toEqual([]) // \d and \s work with every grep
    expect((await runSearch(d, q('run', { word: true }))).hits.map(h => h.path)).toEqual(['src/deep/My Tile.tsx'])
  })

  test('a broken regex is an error, no match is not', async () => {
    expect((await runSearch(d, q('(', { regex: true }))).error).toBeTruthy()
    expect(await runSearch(d, q('nothing-here'))).toEqual({ hits: [], truncated: false, error: null })
  })

  test('stops at the limit and says so', async () => {
    const r = await runSearch(d, q('parseLog', { max: 2 }))
    expect(r.hits).toHaveLength(2)
    expect(r.truncated).toBe(true)
  })

  test('file names: globs, plain words, ignored folders skipped', async () => {
    const names = async (text: string) => (await runSearch(d, q(text, { mode: 'name' }))).hits.map(h => h.path).sort()
    expect(await names('*.tsx')).toEqual(['src/deep/My Tile.tsx'])
    expect(await names('tile')).toEqual(['src/deep/My Tile.tsx'])
    expect(await names('src/*.ts')).toEqual(['src/app.ts', 'src/new.ts'])
    expect(await names('*.js')).toEqual([])
  })

  test('hits stream out as they are found, and together they are the final result', async () => {
    for (const mode of ['content', 'name'] as const) {
      const streamed: string[] = []
      const r = await runSearch(d, q(mode === 'name' ? 'ts' : 'parselog', { mode }), undefined, hits => streamed.push(...hits.map(h => `${h.path}:${h.line ?? ''}`)))
      expect(streamed.length).toBeGreaterThan(0)
      expect(streamed).toEqual(r.hits.map(h => `${h.path}:${h.line ?? ''}`))
    }
  })

  test('case: smart by default, or always matched, or always ignored', async () => {
    const paths = async (o: Partial<SearchQuery>) => (await runSearch(d, q('PARSELOG', o))).hits.map(h => h.path).sort()
    expect(await paths({})).toEqual(['README.md'])
    expect(await paths({ case: 'ignore' })).toEqual(['README.md', 'src/app.ts', 'src/app.ts', 'src/new.ts'])
    expect((await runSearch(d, q('parselog', { case: 'match' }))).hits).toEqual([])
    expect((await runSearch(d, q('TILE', { mode: 'name', case: 'ignore' }))).hits.map(h => h.path)).toEqual(['src/deep/My Tile.tsx'])
  })

  test('only some files, never others: names anywhere, paths from the folder', async () => {
    const paths = async (o: Partial<SearchQuery>, text = 'parselog') => [...new Set((await runSearch(d, q(text, o))).hits.map(h => h.path))].sort()
    expect(await paths({ include: '*.md' })).toEqual(['README.md'])
    expect(await paths({ include: '*.ts, *.md' })).toEqual(['README.md', 'src/app.ts', 'src/new.ts'])
    expect(await paths({ exclude: 'src' })).toEqual(['README.md'])
    expect(await paths({ exclude: 'new.ts' })).toEqual(['README.md', 'src/app.ts'])
    expect(await paths({ exclude: 'src/deep', mode: 'name' }, '*')).not.toContain('src/deep/My Tile.tsx')
    expect(await paths({ include: '*.tsx', mode: 'name' }, '*')).toEqual(['src/deep/My Tile.tsx'])
  })

  test('without subfolders: only what is right in the folder', async () => {
    const top = (o: Partial<SearchQuery>) => runSearch(d, { ...q('parselog'), subfolders: false, ...o })
    expect((await top({})).hits.map(h => h.path)).toEqual(['README.md'])
    expect((await top({ text: 'nothing-here' })).error).toBeNull()
    expect((await top({ text: '*.md', mode: 'name' })).hits.map(h => h.path)).toEqual(['README.md'])
    expect((await top({ text: '*.ts', mode: 'name' })).hits).toEqual([])
    expect((await runSearch(join(d, 'src'), { ...q('*.ts', { mode: 'name' }), subfolders: false })).hits.map(h => h.path).sort()).toEqual(['app.ts', 'new.ts'])
  })
})

test('an aborted search ends quietly', async () => {
  const ac = new AbortController()
  const p = runSearch(project(true), q('parseLog'), ac.signal)
  ac.abort()
  expect((await p).error).toBeNull()
})

test('records from git grep (NUL NUL) and grep (NUL colon) parse the same', () => {
  expect(parseContentRecord('a b/x.ts\x0012\x00text: with colon')).toEqual({ path: 'a b/x.ts', line: 12, text: 'text: with colon' })
  expect(parseContentRecord('./a b/x.ts\x0012:text: with colon')).toEqual({ path: 'a b/x.ts', line: 12, text: 'text: with colon' })
  expect(parseContentRecord('garbage')).toBeNull()
})

test('regex shorthands become POSIX classes, escaped backslashes stay', () => {
  expect(posixRegex('\\w+\\d\\s\\W')).toBe('[[:alnum:]_]+[[:digit:]][[:space:]][^[:alnum:]_]')
  expect(posixRegex('a\\\\w')).toBe('a\\\\w')
})

test('name patterns', () => {
  expect(nameMatcher('*.ts')('src/a.ts')).toBe(true)
  expect(nameMatcher('*.ts')('src/a.tsx')).toBe(false)
  expect(nameMatcher('src/**/*.tsx')('src/x/y/A.tsx')).toBe(true)
  expect(nameMatcher('src/**/*.tsx')('lib/A.tsx')).toBe(false)
  expect(nameMatcher('test?.ts')('a/test1.ts')).toBe(true)
  expect(nameMatcher('Tile')('src/GitTile.tsx')).toBe(true)
  expect(nameMatcher('Tile')('src/gittile.tsx')).toBe(false) // smart case
  expect(nameMatcher('tile')('src/dir-tile/a.ts')).toBe(false) // plain words look at the file name only
})

test('quick open lists the folder it is asked from and below, ignored folders left out', async () => {
  for (const git of [true, false]) {
    const d = realpathSync(project(git))
    const from = await listFiles(join(d, 'src')) // a subfolder, also inside a repository
    expect(from.root).toBe(join(d, 'src'))
    expect(from.files.sort()).toEqual(['app.ts', 'deep/My Tile.tsx', 'new.ts'])
    const all = await listFiles(d)
    expect(all.files).not.toContain('node_modules/lib/index.js')
    expect((await listFiles(d, 2)).truncated).toBe(true)
  }
})
