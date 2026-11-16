import { expect, test } from 'vitest'
import { filesMenu, searchMenu, shortcut, tabColor, tabMenu, type MenuItem } from '../src/shared/menus'

const ids = (items: MenuItem[]): string[] => items.flatMap(i => (i.submenu ? [i.id ?? i.label, ...ids(i.submenu)] : i.id ? [i.id] : []))
const find = (items: MenuItem[], id: string): MenuItem | undefined => items.flatMap(i => [i, ...(i.submenu ?? [])]).find(i => i.id === id)

test('files menu depends on what was clicked', () => {
  expect(ids(filesMenu({ target: 'file', remote: false }))).toEqual(['open', 'copyPath', 'rename', 'duplicate', 'copy', 'cut', 'delete'])
  expect(ids(filesMenu({ target: 'dir', remote: false }))).toEqual(['open', 'split:right', 'split:within', 'copyPath', 'newFile', 'newFolder', 'paste', 'rename', 'duplicate', 'copy', 'cut', 'delete'])
  expect(ids(filesMenu({ target: 'background', remote: false }))).toEqual(['refresh', 'newFile', 'newFolder', 'paste'])
  expect(find(filesMenu({ target: 'file', remote: true }), 'delete')?.label).toBe('Elimina definitivamente…') // no trash over ssh
  expect(find(filesMenu({ target: 'file', remote: false, count: 2 }), 'rename')?.enabled).toBe(false)
  expect(find(filesMenu({ target: 'background', remote: false, paste: 'other-host' }), 'paste')?.enabled).toBe(false)
})

test('tab menu', () => {
  expect(ids(tabMenu({ maximized: false, others: true })).slice(-3)).toEqual(['maximize', 'close', 'closeOthers'])
  expect(find(tabMenu({ maximized: false, others: false }), 'closeOthers')?.enabled).toBe(false)
})

test('shortcuts use Ctrl+Shift on linux', () => {
  expect(shortcut('K', 'darwin')).toBe('CmdOrCtrl+K')
  expect(shortcut('W', 'linux')).toBe('Ctrl+Shift+W')
})

test('search result menu', () => {
  expect(ids(searchMenu({ line: true }))).toEqual(['open', 'copyPath', 'folder'])
  expect(find(searchMenu({ line: true }), 'copyPath')?.label).toBe('Copia percorso:riga')
  expect(find(searchMenu({ line: false }), 'copyPath')?.label).toBe('Copia percorso')
})

test('tab menu: rename, back to the folder name only when renamed, colours with the current one ticked', () => {
  expect(ids(tabMenu({ maximized: false, others: false }))).toEqual(['rename', 'Colore', 'color:', 'color:red', 'color:yellow', 'color:green', 'color:teal', 'color:blue', 'color:purple', 'maximize', 'close', 'closeOthers'])
  expect(ids(tabMenu({ maximized: false, others: false, named: true }))).toContain('unname')
  const m = tabMenu({ maximized: false, others: false, color: 'blue' })
  expect(find(m, 'color:blue')?.label).toBe('✓ Blu')
  expect(find(m, 'color:')?.label).toBe('Nessuno')
})

test('tab colour: only the palette passes', () => {
  expect(tabColor('red')).toBe('red')
  expect(tabColor('pink')).toBeUndefined()
  expect(tabColor(undefined)).toBeUndefined()
})
