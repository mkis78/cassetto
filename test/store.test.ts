import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { loadState, saveState } from '../src/main/store'

const file = () => join(mkdtempSync(join(tmpdir(), 'cassetto-')), 'state.json')

test('missing file gives an empty layout', () => expect(loadState(file())).toEqual({ layout: null }))

test('corrupt file gives default state and is kept aside as .bad', () => {
  const f = file()
  writeFileSync(f, '{oops')
  expect(loadState(f)).toEqual({ layout: null })
  expect(readFileSync(f + '.bad', 'utf8')).toBe('{oops')
})

test('save then load round-trips and leaves no temp file', () => {
  const f = file()
  const s = { layout: { a: 1 }, settings: { theme: 'light' as const } }
  saveState(f, s)
  expect(loadState(f)).toEqual(s)
  expect(existsSync(f + '.tmp')).toBe(false)
})
