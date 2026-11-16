import { expect, test } from 'vitest'
import { changedOptions, ignoreCase, maxHits, pathFilter, patterns } from '../src/shared/query'
import type { SearchQuery } from '../src/shared/types'

const q = (o: Partial<SearchQuery> = {}): SearchQuery => ({ text: 'x', mode: 'content', regex: false, word: false, ...o })

test('case', () => {
  expect(ignoreCase({ text: 'abc' })).toBe(true)
  expect(ignoreCase({ text: 'Abc' })).toBe(false)
  expect(ignoreCase({ text: 'abc', case: 'match' })).toBe(false)
  expect(ignoreCase({ text: 'Abc', case: 'ignore' })).toBe(true)
})

test('pattern lists: commas or lines, ./ and trailing / dropped', () => {
  expect(patterns(' node_modules, *.log\n./build/ ,, ')).toEqual(['node_modules', '*.log', 'build'])
  expect(patterns(undefined)).toEqual([])
})

test('exclude: a name anywhere on the path, a path from the folder and what is inside it', () => {
  const keep = pathFilter({ exclude: 'node_modules, *.LOG, docs/old' })
  expect(keep('src/a.ts')).toBe(true)
  expect(keep('node_modules/x/index.js')).toBe(false)
  expect(keep('pkg/node_modules/x.js')).toBe(false)
  expect(keep('logs/today.log')).toBe(false) // case ignored
  expect(keep('docs/old/a.md')).toBe(false)
  expect(keep('docs/older/a.md')).toBe(true)
})

test('include: file names, or paths', () => {
  const keep = pathFilter({ include: '*.ts, docs/*.md' })
  expect(keep('src/deep/a.ts')).toBe(true)
  expect(keep('docs/a.md')).toBe(true)
  expect(keep('a.md')).toBe(false)
  expect(pathFilter({})('anything')).toBe(true)
})

test('max: default, bounds', () => {
  expect(maxHits(q())).toBe(1000)
  expect(maxHits(q({ max: 0 }))).toBe(1)
  expect(maxHits(q({ max: 1e9 }))).toBe(100000)
})

test('the badge counts the options set away from their defaults; regex and word only for content', () => {
  expect(changedOptions(q())).toBe(0)
  expect(changedOptions(q({ case: 'match', exclude: 'build', max: 500, subfolders: false }))).toBe(4)
  expect(changedOptions(q({ mode: 'name', regex: true, word: true }))).toBe(0)
  expect(changedOptions(q({ exclude: ' , ' }))).toBe(0)
})
