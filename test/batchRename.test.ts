import { expect, test } from 'vitest'
import { conflicts, renamed, splitExt } from '../src/shared/batchRename'

const N = ['IMG_0001.jpg', 'IMG_0002.JPG', 'nota']
const lower = (s: string) => s.toLowerCase()

test('splitExt', () => {
  expect(splitExt('a.tar.gz')).toEqual(['a.tar', '.gz'])
  expect(splitExt('.env')).toEqual(['.env', ''])
  expect(splitExt('Makefile')).toEqual(['Makefile', ''])
})

test('replace', () => {
  const r = (find: string, w: string, cs: boolean, ext = false, names = N) => renamed(names, { kind: 'replace', find, with: w, caseSensitive: cs }, ext)
  expect(r('img_', 'Mare-', false)).toEqual(['Mare-0001.jpg', 'Mare-0002.JPG', 'nota'])
  expect(r('img_', 'Mare-', true)).toEqual(N)
  expect(r('jpg', 'png', false)).toEqual(N)
  expect(r('jpg', 'png', false, true)).toEqual(['IMG_0001.png', 'IMG_0002.png', 'nota'])
  expect(r('', 'x', false)).toEqual(N)
  expect(r('.', '-', false, false, ['a.b.c'])).toEqual(['a-b.c'])
  expect(r('(', '[', false, false, ['a(1).txt'])).toEqual(['a[1).txt'])
  expect(r('a', '$&', false, false, ['a.txt'])).toEqual(['$&.txt'])
})

test('add', () => {
  expect(renamed(N, { kind: 'add', text: 'X', where: 'before' }, false)).toEqual(['XIMG_0001.jpg', 'XIMG_0002.JPG', 'Xnota'])
  expect(renamed(N, { kind: 'add', text: 'X', where: 'after' }, false)).toEqual(['IMG_0001X.jpg', 'IMG_0002X.JPG', 'notaX'])
  expect(renamed(N, { kind: 'add', text: 'X', where: 'after' }, true)).toEqual(['IMG_0001.jpgX', 'IMG_0002.JPGX', 'notaX'])
})

test('format', () => {
  const f = (base: string, where: 'before' | 'after') => renamed(N, { kind: 'format', base, where, start: 9, digits: 2 }, false)
  expect(f('Mare', 'after')).toEqual(['Mare 09.jpg', 'Mare 10.JPG', 'Mare 11'])
  expect(f('Mare', 'before')).toEqual(['09 Mare.jpg', '10 Mare.JPG', '11 Mare'])
  expect(f('', 'after')).toEqual(['09.jpg', '10.JPG', '11'])
})

test('case', () => {
  const c = (to: 'lower' | 'upper' | 'title', ext: boolean, names = N) => renamed(names, { kind: 'case', to }, ext)
  expect(c('lower', false)).toEqual(['img_0001.jpg', 'img_0002.JPG', 'nota'])
  expect(c('upper', false)).toEqual(['IMG_0001.jpg', 'IMG_0002.JPG', 'NOTA'])
  expect(c('upper', true)).toEqual(['IMG_0001.JPG', 'IMG_0002.JPG', 'NOTA'])
  expect(c('title', false, ['ciao-mondo_bello file.txt'])).toEqual(['Ciao-Mondo_Bello File.txt'])
  expect(c('title', false, ['a_-b c'])).toEqual(['A_-B C'])
  expect(c('title', true, ['ciao.TXT'])).toEqual(['Ciao.txt'])
  expect(c('title', false, ['ciao.TXT'])).toEqual(['Ciao.TXT'])
})

test('conflicts', () => {
  const p = (from: string, to: string) => ({ from, to })
  expect(conflicts([p('a', 'x'), p('b', 'x')], ['a', 'b'], s => s)).toEqual(['Nome doppio', 'Nome doppio'])
  expect(conflicts([p('a', 'c')], ['a', 'c'], s => s)).toEqual(['Esiste già'])
  expect(conflicts([p('a', 'b'), p('b', 'a')], ['a', 'b'], s => s)).toEqual([null, null])
  expect(conflicts([p('a', 'a/b')], ['a'], s => s)[0]).toBe('Nome non valido')
  expect(conflicts([p('Foo', 'foo')], ['Foo'], lower)).toEqual([null])
  expect(conflicts([p('a', 'a'), p('b', 'a')], ['a', 'b'], s => s)).toEqual([null, 'Nome doppio'])
  expect(conflicts([p('a', 'B')], ['a', 'b'], lower)).toEqual(['Esiste già'])
  expect(conflicts([p('a', 'x'.repeat(256))], ['a'], s => s)).toEqual(['Nome troppo lungo'])
  expect(conflicts([p('a', 'è'.repeat(128))], ['a'], s => s)).toEqual(['Nome troppo lungo'])
  expect(conflicts([p('a', 'x'.repeat(255))], ['a'], s => s)).toEqual([null])
})
