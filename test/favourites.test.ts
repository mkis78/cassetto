import { expect, test } from 'vitest'
import { addFavourite, moveFavourite, pushRecent } from '../src/shared/favourites'

const a = { host: null, path: '/a' }
const b = { host: null, path: '/b' }
const c = { host: 'srv', path: '/a' }

test('addFavourite appends, ignoring the same host and path', () => {
  expect(addFavourite([a], b)).toEqual([a, b])
  expect(addFavourite([a, b], { ...a, name: 'x' })).toEqual([a, b])
  expect(addFavourite([a], c)).toEqual([a, c]) // same path, another host
})

test('moveFavourite takes one out and puts it at the index', () => {
  expect(moveFavourite([a, b, c], 0, 2)).toEqual([b, c, a])
  expect(moveFavourite([a, b, c], 2, 0)).toEqual([c, a, b])
  expect(moveFavourite([a, b, c], 1, 1)).toEqual([a, b, c])
})

test('pushRecent puts the host first, once, keeping at most 5', () => {
  expect(pushRecent(undefined, 'a')).toEqual(['a'])
  expect(pushRecent(['a', 'b'], 'b')).toEqual(['b', 'a'])
  expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['f', 'a', 'b', 'c', 'd'])
})
