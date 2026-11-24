import { expect, test } from 'vitest'
import { moveWorkspace, withWorkspaces } from '../src/shared/workspaces'
import { workspaceMenu } from '../src/shared/menus'

test('a state from before workspaces keeps its layout in the first one', () => {
  const s = withWorkspaces({ layout: { grid: 1 } })
  expect(s.layout).toBeNull()
  expect(s.workspaces).toMatchObject([{ name: 'Spazio 1', layout: { grid: 1 } }])
  expect(s.activeWs).toBe(s.workspaces![0].id)
  // already there: unchanged, a lost active one falls back to the first
  const w = [{ id: 'a', name: 'A', layout: null }, { id: 'b', name: 'B', layout: null }]
  expect(withWorkspaces({ layout: null, workspaces: w, activeWs: 'b' })).toMatchObject({ workspaces: w, activeWs: 'b' })
  expect(withWorkspaces({ layout: null, workspaces: w, activeWs: 'gone' }).activeWs).toBe('a')
})

test('a dragged workspace takes the place of the one it is dropped on', () => {
  const w = ['a', 'b', 'c'].map(id => ({ id, name: id, layout: null }))
  const order = (l: { id: string }[]) => l.map(x => x.id).join('')
  expect(order(moveWorkspace(w, 'a', 'c'))).toBe('bca')
  expect(order(moveWorkspace(w, 'c', 'a'))).toBe('cab')
  expect(order(moveWorkspace(w, 'b', 'b'))).toBe('abc')
})

test('the last workspace cannot be closed', () => {
  expect(workspaceMenu({ closable: false }).find(i => i.id === 'close')?.enabled).toBe(false)
})
