import { expect, test } from 'vitest'
import { fuzzy, rank } from '../src/shared/fuzzy'

const files = ['src/renderer/GitTile.tsx', 'src/renderer/GitPanels.tsx', 'test/git.test.ts', 'src/main/git.ts', 'README.md', 'src/renderer/terminals.ts']
const top = (q: string) => rank(q, files, f => f).map(r => r.item)

test('characters in order, any case, gaps allowed', () => {
  expect(fuzzy('gtt', 'GitTile.tsx')!.at).toEqual([0, 2, 3])
  expect(fuzzy('xyz', 'GitTile.tsx')).toBeNull()
  expect(fuzzy('tg', 'git')).toBeNull() // order matters
  expect(fuzzy('', 'anything')).toEqual({ score: 0, at: [] })
})

test('ranking: word starts, runs and the file name first', () => {
  expect(top('gittile')[0]).toBe('src/renderer/GitTile.tsx')
  expect(top('gp')[0]).toBe('src/renderer/GitPanels.tsx')
  expect(top('readme')).toEqual(['README.md'])
  expect(top('main git')[0]).toBe('src/main/git.ts')
  expect(top('term')[0]).toBe('src/renderer/terminals.ts')
})
