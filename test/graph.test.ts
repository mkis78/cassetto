import { expect, test } from 'vitest'
import { layoutGraph, reachable } from '../src/shared/graph'
import type { Commit } from '../src/shared/types'

const c = (sha: string, ...parents: string[]): Commit => ({ sha, parents, author: '', time: 0, subject: sha, refs: [] })
const lanes = (rows: ReturnType<typeof layoutGraph>) => rows.map(r => r.lane)

test('linear history stays in lane 0', () => {
  const rows = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')])
  expect(lanes(rows)).toEqual([0, 0, 0])
  expect(rows[0].edges).toEqual([{ from: 0, to: 0 }])
  expect(rows[1].edges).toEqual([{ from: 0, to: 0 }])
  expect(rows[2].edges).toEqual([])
})

test('branch and merge', () => {
  // M merges A (first parent) and B; both come from base
  const rows = layoutGraph([c('M', 'A', 'B'), c('B', 'base'), c('A', 'base'), c('base')])
  expect(lanes(rows)).toEqual([0, 1, 0, 0])
  expect(rows[0].edges).toEqual(expect.arrayContaining([{ from: 0, to: 0 }, { from: 0, to: 1 }]))
  expect(rows[0].edges).toHaveLength(2)
  // B: own lane goes on towards base (still in lane 1 on the next row), A keeps lane 0 passing through
  expect(rows[1].edges).toEqual(expect.arrayContaining([{ from: 0, to: 0 }, { from: 1, to: 1 }]))
  // A: both lanes converge into base, which sits in lane 0
  expect(rows[2].edges).toEqual(expect.arrayContaining([{ from: 0, to: 0 }, { from: 1, to: 0 }]))
  expect(rows[3].edges).toEqual([])
  expect(rows[0].width).toBe(2)
})

test('unrelated roots use different lanes', () => {
  const rows = layoutGraph([c('x2', 'x1'), c('y1'), c('x1')])
  expect(lanes(rows)).toEqual([0, 1, 0])
})

test('a freed lane is reused', () => {
  const rows = layoutGraph([c('M', 'A', 'B'), c('B', 'A'), c('A', 'r'), c('N', 'r'), c('r')])
  // after B merges back into A, lane 1 is free again; N (a new tip) takes it
  expect(lanes(rows)).toEqual([0, 1, 0, 1, 0])
})

// every commit that is a parent of an earlier row must be reached by an edge from the row above
function assertConnected(commits: Commit[]) {
  const rows = layoutGraph(commits)
  const isParent = new Set(commits.flatMap(c => c.parents))
  commits.forEach((cm, i) => {
    if (i === 0 || !isParent.has(cm.sha)) return
    expect(rows[i - 1].edges.some(e => e.to === rows[i].lane), `edge into ${cm.sha}`).toBe(true)
  })
  rows.forEach((r, i) => i + 1 < rows.length && r.edges.forEach(e => expect(e.to).toBeLessThan(Math.max(rows[i + 1].width, e.to + 1))))
  return rows
}

test('octopus merge fans out to three lanes', () => {
  const rows = assertConnected([c('M', 'A', 'B', 'C'), c('C', 'r'), c('B', 'r'), c('A', 'r'), c('r')])
  expect(rows[0].edges.map(e => e.to).sort()).toEqual([0, 1, 2])
})

test('criss-cross merges stay connected', () => {
  assertConnected([c('X', 'A', 'B'), c('Y', 'B', 'A'), c('A', 'r'), c('B', 'r'), c('r')])
})

test('parents outside the loaded window keep their lane open', () => {
  const rows = assertConnected([c('b', 'a'), c('z', 'outside')])
  expect(rows[1].edges).toContainEqual({ from: rows[1].lane, to: rows[1].lane })
})

test('reachable follows every parent, ignores what is not loaded', () => {
  const cs = [c('m2', 'm1', 'f1'), c('f1', 'm0'), c('m1', 'm0'), c('x', 'm0'), c('m0', 'gone')]
  expect(reachable(cs, 'm2')).toEqual(new Set(['m2', 'm1', 'f1', 'm0']))
  expect(reachable(cs, 'f1')).toEqual(new Set(['f1', 'm0']))
  expect(reachable(cs, 'zzz')).toBe(null) // a stash, a hidden branch: nothing to light up, nothing to dim
})
