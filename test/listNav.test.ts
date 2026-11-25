import { expect, test } from 'vitest'
import { listKey, typeAhead, windowOf } from '../src/shared/listNav'

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

test('a long list draws the rows in view and a screen either side, blank space for the rest', () => {
  const rows = { start: 0, pitch: 20, item: 20, perRow: 1 } // a list: 20px rows, no gap
  expect(windowOf(100_000, rows, 0, 400)).toEqual({ from: 0, to: 41, before: 0, after: (100_000 - 41) * 20 })
  expect(windowOf(100_000, rows, 20_000, 400)).toEqual({ from: 980, to: 1041, before: 980 * 20, after: (100_000 - 1041) * 20 })
  expect(windowOf(100_000, rows, 2_000_000, 400)).toMatchObject({ from: 99_980, to: 100_000, after: 0 }) // the end
  // icons: 5 to a row, 100px tiles 104px apart; whole rows only, and the spaces leave one gap out
  const grid = { start: 6, pitch: 104, item: 100, perRow: 5 }
  const w = windowOf(1003, grid, 6 + 104 * 50, 520)
  expect(w.from % 5).toBe(0)
  expect(w).toEqual({ from: 225, to: 305, before: 45 * 104 - 4, after: (201 - 61) * 104 - 4 }) // rows 45…61 of 201
})
