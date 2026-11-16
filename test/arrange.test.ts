import { expect, test } from 'vitest'
import { arrange, type Layout } from '../src/shared/arrange'

const panel = (id: string, extra: Record<string, unknown> = {}) => ({ id, contentComponent: 'files', title: id, params: { kind: 'files', host: null, path: `/${id}`, ...extra } })
// three tabs in one group, b in front, in a 1200×800 window
const three = (): Layout => ({
  grid: { root: { type: 'branch', data: [{ type: 'leaf', data: { views: ['a', 'b', 'c'], activeView: 'b', id: '1' }, size: 1200 }], size: 800 }, width: 1200, height: 800, orientation: 'HORIZONTAL' },
  panels: { a: panel('a'), b: panel('b', { name: 'Mio', color: 'red' }), c: panel('c') },
  activeGroup: '1'
})
let n = 0
const newId = () => `new${++n}`

test('two side by side: one tab each, the extra ones in the last cell, sizes split evenly', () => {
  const l = arrange(three(), 'two', 'b', newId)
  expect(l.grid.orientation).toBe('HORIZONTAL')
  expect(l.grid.root).toEqual({
    type: 'branch',
    size: 800,
    data: [
      { type: 'leaf', size: 600, data: { views: ['a'], activeView: 'a', id: '1' } },
      { type: 'leaf', size: 600, data: { views: ['b', 'c'], activeView: 'b', id: '2' } }
    ]
  })
  expect(l.activeGroup).toBe('2')
  expect(Object.keys(l.panels)).toEqual(['a', 'b', 'c'])
})

test('stacked: a vertical root, the heights split', () => {
  const l = arrange(three(), 'stacked', 'a', newId)
  expect(l.grid.orientation).toBe('VERTICAL')
  expect(l.grid.root.size).toBe(1200)
  expect((l.grid.root as { data: { size: number }[] }).data.map(c => c.size)).toEqual([400, 400])
  expect(l.activeGroup).toBe('1')
})

test('a 2×2 grid with three tabs opens a fourth on the folder of the one in front, without its name or colour', () => {
  n = 0
  const l = arrange(three(), 'grid', 'b', newId)
  const cols = (l.grid.root as { data: { type: string; size: number; data: { size: number; data: { views: string[] } }[] }[] }).data
  expect(cols.map(c => [c.type, c.size])).toEqual([['branch', 600], ['branch', 600]])
  expect(cols.flatMap(c => c.data.map(x => x.size))).toEqual([400, 400, 400, 400])
  expect(cols.flatMap(c => c.data.map(x => x.data.views))).toEqual([['a'], ['b'], ['c'], ['new1']])
  expect(l.panels.new1).toMatchObject({ id: 'new1', params: { kind: 'files', path: '/b' } })
  expect(l.panels.new1.params).not.toHaveProperty('name')
  expect(l.panels.new1.params).not.toHaveProperty('color')
  expect(l.panels.b.params).toHaveProperty('name', 'Mio') // the original keeps them
})

test('one panel gathers every tab', () => {
  const two = arrange(three(), 'two', 'c', newId)
  const one = arrange(two, 'one', 'c', newId)
  expect(one.grid.root).toEqual({ type: 'branch', size: 800, data: [{ type: 'leaf', size: 1200, data: { views: ['a', 'b', 'c'], activeView: 'c', id: '1' } }] })
})
