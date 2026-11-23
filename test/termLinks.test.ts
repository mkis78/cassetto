import { expect, test } from 'vitest'
import { findPaths, resolvePath } from '../src/shared/termLinks'

const refs = (l: string) => findPaths(l).map(r => `${r.start}:${r.path}${r.line ? `@${r.line}` : ''}`)

test('file references as tools print them', () => {
  expect(refs('Update(src/renderer/App.tsx)')).toEqual(['7:src/renderer/App.tsx'])
  expect(refs('  ⎿ edited ./a.ts:42 and /abs/x.py:3:7.')).toEqual(['11:./a.ts@42', '25:/abs/x.py@3'])
  expect(refs('see ~/notes/todo.md, then ../up.json')).toEqual(['4:~/notes/todo.md', '26:../up.json'])
  expect(refs('FAIL test/git.test.ts > on a real repository')).toEqual(['5:test/git.test.ts'])
  expect(refs('README.md')).toEqual(['0:README.md'])
})

test('not files: words, versions, URLs, e-mail addresses', () => {
  expect(refs('hello world, done.')).toEqual([])
  expect(refs('upgraded to 1.2.3 and v0.10.1')).toEqual([])
  expect(refs('open https://github.com/mkis78/cassetto/releases.html now')).toEqual([])
  expect(refs('mail ada@example.com')).toEqual(['5:ada@example.com']) // looks like a name with an extension: the existence check drops it
})

test('a printed path, resolved against the terminal folder', () => {
  expect(resolvePath('/w/repo/', 'src/a.ts', '/home/u')).toBe('/w/repo/src/a.ts')
  expect(resolvePath('/w/repo', './a.ts', '/home/u')).toBe('/w/repo/a.ts')
  expect(resolvePath('/w/repo', '../up.json', '/home/u')).toBe('/w/up.json')
  expect(resolvePath('/w/repo', '/abs/./x/../y.py', '/home/u')).toBe('/abs/y.py')
  expect(resolvePath('/w/repo', '~/notes/todo.md', '/home/u')).toBe('/home/u/notes/todo.md')
  expect(resolvePath('/w', '~/notes/todo.md', null)).toBeNull() // a remote home is not known here
  expect(resolvePath('/', '../../a.ts', null)).toBe('/a.ts')
})
