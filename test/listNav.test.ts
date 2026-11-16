import { expect, test } from 'vitest'
import { listKey, typeAhead } from '../src/shared/listNav'

test('arrows, page and ends stay inside the list', () => {
  expect(listKey('ArrowDown', -1, 3)).toBe(0) // nothing selected: down starts at the top
  expect(listKey('ArrowUp', -1, 3)).toBe(2) // ...and up at the bottom
  expect(listKey('ArrowDown', 2, 3)).toBe(2)
  expect(listKey('ArrowUp', 0, 3)).toBe(0)
  expect(listKey('PageDown', -1, 30)).toBe(10)
  expect(listKey('PageDown', 25, 30)).toBe(29)
  expect(listKey('PageUp', 5, 30)).toBe(0)
  expect(listKey('End', 0, 30)).toBe(29)
  expect(listKey('Home', 9, 30)).toBe(0)
  expect(listKey('ArrowDown', -1, 0)).toBeNull()
  expect(listKey('Enter', 1, 3)).toBeNull()
})

test('type-ahead jumps to the next name with that letter, wrapping around', () => {
  const names = ['src', 'Sass', 'test', 'setup.ts']
  expect(typeAhead(names, -1, 's')).toBe(0)
  expect(typeAhead(names, 0, 'S')).toBe(1)
  expect(typeAhead(names, 1, 's')).toBe(3)
  expect(typeAhead(names, 3, 's')).toBe(0)
  expect(typeAhead(names, 2, 'x')).toBe(2)
})
