import { expect, test } from 'vitest'
import { actionsMenu, changeMenu, commitMenu, dropMenu, favouriteMenu, fileRefMenu, refMenu, stashMenu, worktreeMenu, tagsMenu, terminalMenu, filesMenu, layoutsMenu, putLayout, searchMenu, viewMenu, shortcut, tabColor, tabMenu, type MenuItem } from '../src/shared/menus'

const ids = (items: MenuItem[]): string[] => items.flatMap(i => (i.submenu ? [i.id ?? i.label, ...ids(i.submenu)] : i.id ? [i.id] : []))
const find = (items: MenuItem[], id: string): MenuItem | undefined => items.flatMap(i => [i, ...(i.submenu ?? [])]).find(i => i.id === id)

test('files menu depends on what was clicked', () => {
  expect(ids(filesMenu({ target: 'file', remote: false }))).toEqual(['open', 'edit', 'copyPath', 'rename', 'duplicate', 'copy', 'cut', 'delete'])
  expect(ids(filesMenu({ target: 'dir', remote: false }))).toEqual(['open', 'split:right', 'split:within', 'terminal', 'copyPath', 'favourite', 'newFile', 'newFolder', 'paste', 'rename', 'duplicate', 'copy', 'cut', 'delete'])
  expect(ids(filesMenu({ target: 'background', remote: false }))).toEqual(['refresh', 'terminal', 'newFile', 'newFolder', 'paste'])
  expect(find(filesMenu({ target: 'file', remote: true }), 'delete')?.label).toBe('Elimina definitivamente…') // no trash over ssh
  expect(find(filesMenu({ target: 'file', remote: false, count: 2 }), 'rename')).toMatchObject({ label: 'Rinomina 2 elementi…', enabled: true })
  expect(find(filesMenu({ target: 'file', remote: false, count: 1 }), 'rename')).toMatchObject({ label: 'Rinomina', enabled: true })
  expect(find(filesMenu({ target: 'file', remote: false, count: 0 }), 'rename')?.enabled).toBe(false)
  expect(find(filesMenu({ target: 'background', remote: false, paste: false }), 'paste')?.enabled).toBe(false)
})

test('open with submenu, local files only', () => {
  const sub = filesMenu({ target: 'file', remote: false, openWith: [{ id: 'a', name: 'A' }] }).find(i => i.label === 'Apri con')
  expect(ids(sub ? [sub] : [])).toEqual(['Apri con', 'openWith:0', 'openWith:other'])
  expect(ids(filesMenu({ target: 'file', remote: false, openWith: [] }))).toContain('openWith:other')
  expect(ids(filesMenu({ target: 'file', remote: true, openWith: [{ id: 'a', name: 'A' }] }))).not.toContain('Apri con')
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

test('actions menu: nothing to create in a folder that failed, paste when the clipboard holds something', () => {
  expect(ids(actionsMenu({ ready: true, paste: false }))).toEqual(['newFile', 'newFolder', 'terminal', 'paste', 'refresh'])
  expect(find(actionsMenu({ ready: false, paste: true }), 'newFile')?.enabled).toBe(false)
  expect(find(actionsMenu({ ready: true, paste: false }), 'paste')?.enabled).toBe(false)
  expect(find(actionsMenu({ ready: true, paste: true }), 'paste')?.enabled).toBe(true)
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

test('Estrai qui only for an archive file', () => {
  expect(ids(filesMenu({ target: 'file', remote: false, archive: true }))).toContain('extract')
  expect(ids(filesMenu({ target: 'file', remote: false }))).not.toContain('extract')
})

test('git here: in local files menus right after the terminal, only when the compartment is on', () => {
  const at = (m: MenuItem[]) => ids(m).indexOf('git') - ids(m).indexOf('terminal')
  expect(at(filesMenu({ target: 'background', remote: false, git: true }))).toBe(1)
  expect(at(filesMenu({ target: 'dir', remote: false, git: true }))).toBe(1)
  expect(at(actionsMenu({ ready: true, paste: false, git: true }))).toBe(1)
  expect(ids(filesMenu({ target: 'background', remote: true, git: true }))).not.toContain('git')
  expect(ids(filesMenu({ target: 'background', remote: false }))).not.toContain('git')
  expect(ids(filesMenu({ target: 'dir', remote: false, git: true, readOnly: true }))).not.toContain('git') // inside an archive
  expect(ids(actionsMenu({ ready: true, paste: false }))).not.toContain('git')
})

test('commit menu: branches on the commit, nothing to merge into when detached, no cherry-pick of a merge', () => {
  const m = commitMenu({ current: 'main', branches: ['main', 'feat', 'origin/feat'], merge: false })
  expect(ids(m)).toEqual(['branch', 'tag', 'checkout:feat', 'checkout:origin/feat', 'merge:feat', 'rebase:feat', 'merge:origin/feat', 'rebase:origin/feat', 'cherryPick', 'revert', 'Reset main qui', 'reset:soft', 'reset:mixed', 'reset:hard', 'copySha'])
  const detached = commitMenu({ current: null, branches: ['feat'], merge: true })
  expect(ids(detached)).not.toContain('merge:feat')
  expect(find(detached, 'cherryPick')?.enabled).toBe(false)
})

test('git ref, stash, file and worktree menus', () => {
  expect(ids(refMenu({ name: 'feat', kind: 'branch', current: 'main', remotes: ['origin'] }))).toEqual(['checkout', 'merge', 'rebase', 'push:origin', 'rename', 'delete', 'solo', 'hide', 'copy'])
  expect(ids(refMenu({ name: 'feat', kind: 'branch', current: 'main', remotes: [], hidden: true }))).toContain('show')
  const self = refMenu({ name: 'main', kind: 'branch', current: 'main', remotes: [] })
  expect(ids(self)).toEqual(['checkout', 'rename', 'delete', 'solo', 'hide', 'copy'])
  expect(find(self, 'delete')?.enabled).toBe(false)
  expect(ids(refMenu({ name: 'origin/x', kind: 'remote', current: 'main', remotes: ['origin'] }))).toEqual(['checkout', 'merge', 'rebase', 'deleteRemote', 'solo', 'hide', 'copy'])
  expect(ids(refMenu({ name: 'v1', kind: 'tag', current: 'main', remotes: [] }))).toEqual(['copy'])
  expect(ids(stashMenu())).toEqual(['apply', 'pop', 'drop'])
  expect(ids(changeMenu({ staged: false, untracked: true }))).toEqual(['stage', 'discard', 'open', 'copyPath'])
  expect(ids(changeMenu({ staged: true, untracked: false }))).toEqual(['unstage', 'open', 'copyPath'])
  expect(ids(fileRefMenu())).toEqual(['open', 'copyPath'])
  expect(ids(worktreeMenu())).toEqual(['folder', 'copyPath', 'removeWorktree'])
})

test('drop menu: what dragging a branch onto something offers', () => {
  expect(ids(dropMenu({ source: 'feat', sourceRemote: false, target: 'main', targetKind: 'branch' }))).toEqual(['merge', 'rebase'])
  expect(ids(dropMenu({ source: 'origin/feat', sourceRemote: true, target: 'main', targetKind: 'branch' }))).toEqual(['merge'])
  expect(ids(dropMenu({ source: 'feat', sourceRemote: false, target: 'origin/main', targetKind: 'remote' }))).toEqual(['mergeInto:source', 'rebase'])
  expect(ids(dropMenu({ source: 'feat', sourceRemote: false, target: 'origin', targetKind: 'remoteName' }))).toEqual(['push'])
  expect(dropMenu({ source: 'origin/feat', sourceRemote: true, target: 'origin', targetKind: 'remoteName' })).toEqual([])
})
