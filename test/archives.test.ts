import { expect, test } from 'vitest'
import { displayPath, insideArchive, parentOf } from '../src/shared/archives'
import { actionsMenu, filesMenu, type MenuItem } from '../src/shared/menus'

const one = [{ archive: '/d/foto.zip', root: '/c/k1' }]
const two = [{ archive: '/d/a.zip', root: '/c/k1' }, { archive: '/c/k1/in/b.tar', root: '/c/k2' }]

test('displayPath shows archives as folders', () => {
  expect(displayPath('/c/k1/2024/mare', one)).toBe('/d/foto.zip › 2024/mare')
  expect(displayPath('/c/k1', one)).toBe('/d/foto.zip ›')
  expect(displayPath('/c/k2/x', two)).toBe('/d/a.zip › in/b.tar › x')
  expect(displayPath('/home/x', one)).toBe('/home/x')
})

test('parentOf leaves the archive at its root', () => {
  expect(parentOf('/c/k1', one)).toEqual({ path: '/d', levels: [], select: '/d/foto.zip' })
  expect(parentOf('/c/k1/2024', one)).toEqual({ path: '/c/k1', levels: one })
  expect(parentOf('/c/k2', two)).toEqual({ path: '/c/k1/in', levels: [two[0]], select: '/c/k1/in/b.tar' })
})

test('insideArchive', () => {
  expect(insideArchive('/c/k1', one)).toBe(true)
  expect(insideArchive('/c/k1/a', one)).toBe(true)
  expect(insideArchive('/c/k10', one)).toBe(false)
  expect(insideArchive('/c/k1', [])).toBe(false)
})

const ids = (items: MenuItem[]): string[] => items.flatMap(i => (i.submenu ? ids(i.submenu) : i.id ? [i.id] : []))
const noStraySeps = (items: MenuItem[]): boolean => items.every((i, n) => !i.separator || (n > 0 && n < items.length - 1 && !items[n - 1].separator))

test('read-only menus keep only non-modifying items', () => {
  const allowed = ['open', 'openWith:0', 'openWith:other', 'copy', 'copyPath', 'terminal', 'refresh']
  const file = filesMenu({ target: 'file', remote: false, readOnly: true, openWith: [{ id: 'a', name: 'A' }] as never })
  expect(ids(file).every(i => allowed.includes(i))).toBe(true)
  expect(ids(file)).toEqual(expect.arrayContaining(['open', 'copy', 'copyPath']))
  expect(noStraySeps(file)).toBe(true)
  const bg = filesMenu({ target: 'background', remote: false, readOnly: true })
  expect(ids(bg)).toEqual(['refresh', 'terminal'])
  expect(noStraySeps(filesMenu({ target: 'dir', remote: false, readOnly: true }))).toBe(true)
  expect(ids(actionsMenu({ ready: true, paste: true, readOnly: true }))).toEqual(['terminal', 'refresh'])
})
