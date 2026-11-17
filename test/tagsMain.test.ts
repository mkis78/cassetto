import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { editTags, folderTags, parseXattrHex, readTags, runTagSearch } from '../src/main/tags'
import type { SearchQuery } from '../src/shared/types'

test('xattr -px output for several files, names with ": " and spaces', () => {
  const out = '/a/x y.txt: \n62 70 6C\n69 73\n/a/c: d.txt: \n41\n'
  expect([...parseXattrHex(out)].map(([p, b]) => [p, [...b]])).toEqual([['/a/x y.txt', [0x62, 0x70, 0x6c, 0x69, 0x73]], ['/a/c: d.txt', [0x41]]])
})

describe.skipIf(process.platform !== 'darwin')('on real files', () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'ctags-')))
  mkdirSync(join(d, 'sub'))
  for (const f of ['a.txt', 'b c.txt', 'sub/deep.md']) writeFileSync(join(d, f), 'x')
  const q = (text: string, o: Partial<SearchQuery> = {}): SearchQuery => ({ text, mode: 'tag', regex: false, word: false, ...o })

  test('add, read, change colour, take off', async () => {
    expect((await editTags([join(d, 'a.txt'), join(d, 'sub')], { add: [{ name: 'Rosso', color: 6 }, { name: 'Lavoro', color: 0 }] })).failed).toEqual([])
    await editTags([join(d, 'sub/deep.md')], { add: [{ name: 'Lavoro', color: 4 }] })
    expect((await folderTags(d)).get('a.txt')).toEqual([{ name: 'Rosso', color: 6 }, { name: 'Lavoro', color: 0 }])
    expect([...(await folderTags(d)).keys()].sort()).toEqual(['a.txt', 'sub'])
    await editTags([join(d, 'a.txt')], { remove: ['Rosso'] })
    expect((await readTags([join(d, 'a.txt'), join(d, 'b c.txt')])).get(join(d, 'a.txt'))).toEqual([{ name: 'Lavoro', color: 0 }])
    expect((await editTags([join(d, 'b c.txt')], { remove: ['Mai messo'] })).failed).toEqual([]) // nothing to take off: fine
    // the Finder's own reading agrees (mdls may lag behind the index; the attribute itself is what it stores)
    expect(execFileSync('xattr', ['-l', join(d, 'a.txt')]).toString()).toContain('_kMDItemUserTags')
  })

  test('search by tag name or colour, with or without subfolders', async () => {
    const paths = async (o: SearchQuery) => (await runTagSearch(d, o)).hits.map(h => h.path).sort()
    expect(await paths(q('lavoro'))).toEqual(['a.txt', 'sub', 'sub/deep.md'])
    expect(await paths(q('blu'))).toEqual(['sub/deep.md']) // the colour of a tag named otherwise
    expect(await paths(q('lavoro', { subfolders: false }))).toEqual(['a.txt', 'sub'])
    expect(await paths(q('lavoro', { exclude: 'sub' }))).toEqual(['a.txt'])
    expect((await runTagSearch(d, q('lavoro'))).hits.find(h => h.path === 'a.txt')?.tags).toEqual([{ name: 'Lavoro', color: 0 }])
  })
})
