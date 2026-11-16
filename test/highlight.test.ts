import { expect, test } from 'vitest'
import { highlight } from '../src/shared/highlight'
import type { SearchQuery } from '../src/shared/types'

const q = (text: string, o: Partial<SearchQuery> = {}): SearchQuery => ({ text, mode: 'content', regex: false, word: false, ...o })

test('splits a line into plain and matched parts', () => {
  expect(highlight('a parseLog(b) PARSELOG', q('parselog'))).toEqual([
    { text: 'a ', match: false },
    { text: 'parseLog', match: true },
    { text: '(b) ', match: false },
    { text: 'PARSELOG', match: true }
  ])
  expect(highlight('a parseLog PARSELOG', q('PARSELOG')).filter(p => p.match).map(p => p.text)).toEqual(['PARSELOG'])
})

test('plain text, whole words and regex', () => {
  expect(highlight('f(a) f(a', q('f(a)')).filter(p => p.match)).toHaveLength(1)
  expect(highlight('run rerun', q('run', { word: true })).filter(p => p.match).map(p => p.text)).toEqual(['run'])
  expect(highlight('function GitTile()', q('function \\w+Tile', { regex: true })).filter(p => p.match).map(p => p.text)).toEqual(['function GitTile'])
})

test('a regex JavaScript cannot read, or one matching nothing, leaves the line plain', () => {
  expect(highlight('abc', q('(', { regex: true }))).toEqual([{ text: 'abc', match: false }])
  expect(highlight('abc', q('x*', { regex: true }))).toEqual([{ text: 'abc', match: false }])
})
