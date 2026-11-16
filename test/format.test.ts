import { expect, test } from 'vitest'
import { formatSize, imageType } from '../src/shared/format'

test('file sizes', () => {
  expect(formatSize(0)).toBe('0 B')
  expect(formatSize(999)).toBe('999 B')
  expect(formatSize(1500)).toBe('1,5 KB')
  expect(formatSize(12_345_678)).toBe('12 MB')
  expect(formatSize(3e15)).toBe('3000 TB') // no unit above TB
})

test('image types by extension', () => {
  expect(imageType('a/Photo.JPG')).toBe('image/jpeg')
  expect(imageType('logo.svg')).toBe('image/svg+xml')
  expect(imageType('notes.txt')).toBeUndefined()
  expect(imageType('png')).toBeUndefined() // a name without a dot is not an extension
})
