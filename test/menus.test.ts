import { expect, test } from 'vitest'
import { actionsMenu, favouriteMenu, tagsMenu, terminalMenu, filesMenu, layoutsMenu, putLayout, searchMenu, viewMenu, shortcut, tabColor, tabMenu, type MenuItem } from '../src/shared/menus'

const ids = (items: MenuItem[]): string[] => items.flatMap(i => (i.submenu ? [i.id ?? i.label, ...ids(i.submenu)] : i.id ? [i.id] : []))
const find = (items: MenuItem[], id: string): MenuItem | undefined => items.flatMap(i => [i, ...(i.submenu ?? [])]).find(i => i.id === id)

test('files menu depends on what was clicked', () => {
  expect(ids(filesMenu({ target: 'file', remote: false }))).toEqual(['open', 'edit', 'copyPath', 'rename', 'duplicate', 'copy', 'cut', 'delete'])
  expect(ids(filesMenu({ target: 'dir', remote: false }))).toEqual(['open', 'split:right', 'split:within', 'terminal', 'copyPath', 'favourite', 'newFile', 'newFolder', 'paste', 'rename', 'duplicate', 'copy', 'cut', 'delete'])
  expect(ids(filesMenu({ target: 'background', remote: false }))).toEqual(['refresh', 'terminal', 'newFile', 'newFolder', 'paste'])
  expect(find(filesMenu({ target: 'file', remote: true }), 'delete')?.label).toBe('Elimina definitivamente…') // no trash over ssh
  expect(find(filesMenu({ target: 'file', remote: false, count: 2 }), 'rename')?.enabled).toBe(false)
  expect(find(filesMenu({ target: 'background', remote: false, paste: 'other-host' }), 'paste')?.enabled).toBe(false)
})

test('favourite menu', () => {
  expect(ids(favouriteMenu({}))).toEqual(['rename', 'Colore', 'color:', 'color:red', 'color:yellow', 'color:green', 'color:teal', 'color:blue', 'color:purple', 'remove'])
  expect(find(favouriteMenu({ color: 'red' }), 'color:red')?.label).toBe('✓ Rosso')
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

test('view menu: the current view and toggles ticked, no side preview in the gallery', () => {
  const m = viewMenu({ view: 'icons', hidden: true, preview: false })
  expect(ids(m)).toEqual(['view:list', 'view:icons', 'view:columns', 'view:gallery', 'hidden', 'preview'])
  expect(m.filter(i => i.checked).map(i => i.id)).toEqual(['view:icons', 'hidden'])
  expect(find(m, 'preview')?.checked).toBe(false) // still a checkbox
  expect(find(viewMenu({ view: 'gallery', hidden: false, preview: true }), 'preview')?.enabled).toBe(false)
})

test('actions menu: nothing to create in a folder that failed, paste only from the same host', () => {
  expect(ids(actionsMenu({ ready: true, paste: null }))).toEqual(['newFile', 'newFolder', 'terminal', 'paste', 'refresh'])
  expect(find(actionsMenu({ ready: false, paste: 'ok' }), 'newFile')?.enabled).toBe(false)
  expect(find(actionsMenu({ ready: true, paste: 'other-host' }), 'paste')?.enabled).toBe(false)
  expect(find(actionsMenu({ ready: true, paste: 'ok' }), 'paste')?.enabled).toBe(true)
})

test('layouts menu: save, then each layout to open and to delete', () => {
  expect(ids(layoutsMenu([]))).toEqual(['save'])
  expect(ids(layoutsMenu(['Foto', 'Progetto X']))).toEqual(['save', 'layout:Foto', 'layout:Progetto X', 'Elimina', 'delete:Foto', 'delete:Progetto X'])
})

test('saving a layout under a taken name replaces it in place', () => {
  const list = [{ name: 'a', layout: 1 }, { name: 'b', layout: 2 }]
  expect(putLayout(list, { name: 'a', layout: 3 })).toEqual([{ name: 'a', layout: 3 }, { name: 'b', layout: 2 }])
  expect(putLayout(list, { name: 'c', layout: 4 }).map(l => l.name)).toEqual(['a', 'b', 'c'])
  expect(putLayout(undefined, { name: 'a', layout: 1 })).toHaveLength(1)
})

test('layouts menu: the arrangements first, then save and the saved ones', () => {
  expect(ids(layoutsMenu(['Foto'], [{ id: 'two', label: 'Due affiancati' }, { id: 'grid', label: 'Griglia 2×2' }]))).toEqual(['arrange:two', 'arrange:grid', 'save', 'layout:Foto', 'Elimina', 'delete:Foto'])
})

test('terminal menu: copy only with a selection, the folder it started in, close', () => {
  expect(ids(terminalMenu({ hasSelection: false, platform: 'darwin' }))).toEqual(['copy', 'paste', 'selectAll', 'find', 'clear', 'folder', 'close'])
  expect(find(terminalMenu({ hasSelection: false, platform: 'darwin' }), 'copy')?.enabled).toBe(false)
  expect(find(terminalMenu({ hasSelection: true, platform: 'linux' }), 'copy')?.accelerator).toBe('Ctrl+Shift+C') // Ctrl+C stays an interrupt
})

test('tag submenu: ticked when every item has the tag, marked when only some do; only for local files', () => {
  const known = [{ name: 'Rosso', color: 6 }, { name: 'Lavoro', color: 0 }]
  const m = tagsMenu({ known, has: n => (n === 'Rosso' ? 'all' : 'some'), dots: ['', '#888', '', '', '', '', '#f00', ''] })
  expect(ids(m.submenu!)).toEqual(['tag:0', 'tag:1', 'tags'])
  expect(m.submenu![0]).toMatchObject({ checked: true, dot: '#f00', hollow: false })
  expect(m.submenu![1]).toMatchObject({ label: 'Lavoro (alcuni)', checked: false, hollow: true })
  expect(ids(filesMenu({ target: 'file', remote: false, tags: m }))).toContain('tags')
  expect(ids(filesMenu({ target: 'file', remote: true }))).not.toContain('tags')
})
