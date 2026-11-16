import { expect, test } from 'vitest'
import { copyName, isInside, nameError, okPrefix, rangeSelect } from '../src/shared/fileOps'

test('okPrefix keeps listings up to the first failure', () => {
  const ok = (n: number) => ({ ok: true as const, listing: n })
  const bad = { ok: false as const, error: 'x' }
  expect(okPrefix([ok(1), ok(2), bad, ok(4)])).toEqual([1, 2])
  expect(okPrefix([bad, ok(2)])).toEqual([])
  expect(okPrefix([ok(1)])).toEqual([1])
})

test('copyName', () => {
  expect(copyName('a.txt', new Set(['a.txt']))).toBe('a copia.txt')
  expect(copyName('a.txt', new Set(['a.txt', 'a copia.txt']))).toBe('a copia 2.txt')
  expect(copyName('dir', new Set(['dir']))).toBe('dir copia')
  expect(copyName('.env', new Set(['.env']))).toBe('.env copia')
  expect(copyName('x.tar.gz', new Set())).toBe('x.tar copia.gz')
  // a case-insensitive disk: "A copia.txt" is taken by "a copia.txt"
  const folded = new Set(['a.txt', 'a copia.txt'])
  expect(copyName('A.txt', { has: n => folded.has(n.toLowerCase()) })).toBe('A copia 2.txt')
})

test('isInside compares by segment', () => {
  expect(isInside('/a/b', '/a/b')).toBe(true)
  expect(isInside('/a/b', '/a/b/c')).toBe(true)
  expect(isInside('/a/b', '/a/bc')).toBe(false)
  expect(isInside('/a/b', '/a')).toBe(false)
})

test('nameError', () => {
  const t = new Set(['x'])
  expect(nameError('', t)).toBe('Nome vuoto')
  expect(nameError('  ', t)).toBe('Nome vuoto')
  expect(nameError('a/b', t)).toBe('Nome non valido')
  expect(nameError('a\0b', t)).toBe('Nome non valido')
  expect(nameError('..', t)).toBe('Nome non valido')
  expect(nameError('x', t)).toBe('Esiste già')
  expect(nameError('y', t)).toBeNull()
})

test('rangeSelect works both ways', () => {
  expect(rangeSelect(['a', 'b', 'c', 'd'], 'b', 'd')).toEqual(['b', 'c', 'd'])
  expect(rangeSelect(['a', 'b', 'c', 'd'], 'c', 'a')).toEqual(['a', 'b', 'c'])
  expect(rangeSelect(['a', 'b'], 'gone', 'b')).toEqual(['b'])
})
