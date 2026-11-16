import { expect, test } from 'vitest'
import { detectIndent, joinLines, sortLines, titleCase, trimTrailing } from '../src/shared/textOps'

test('sort lines: case ignored, numbers in natural order', () => {
  expect(sortLines('file10\nFile2\nalfa\nbeta')).toBe('alfa\nbeta\nFile2\nfile10')
})

test('join lines: one space, indentation of the joined lines gone, blank ones skipped', () => {
  expect(joinLines('  foo(\n    a,\n\n    b\n  )')).toBe('  foo( a, b )')
  expect(joinLines('solo')).toBe('solo')
})

test('trailing whitespace and title case', () => {
  expect(trimTrailing('a  \nb\t\n  c')).toBe('a\nb\n  c')
  expect(titleCase('ciao MONDO-bello')).toBe('Ciao Mondo-Bello')
  expect(titleCase('è già così')).toBe('È Già Così')
})

test('indentation of a file', () => {
  expect(detectIndent('a\n  b\n    c\n  d\n')).toEqual({ tabs: false, size: 2 })
  expect(detectIndent('a\n    b\n        c\n')).toEqual({ tabs: false, size: 4 })
  expect(detectIndent('a\n\tb\n\t\tc\n')).toEqual({ tabs: true, size: 4 })
  expect(detectIndent('a\nb\n')).toBeNull()
  expect(detectIndent('/**\n * doc\n */\nx\n  y\n')).toEqual({ tabs: false, size: 2 }) // a lone space of a comment is no step
})
