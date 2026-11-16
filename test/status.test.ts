import { expect, test } from 'vitest'
import { diskSummary, folderSummary, kindOf, parseDf, parseDu, selectionSummary } from '../src/shared/status'

const f = (name: string, size?: number) => ({ name, dir: false, size })
const d = (name: string) => ({ name, dir: true })

test('kind of file, from the extension', () => {
  expect(kindOf('Fattura.PDF', false)).toBe('Documento PDF')
  expect(kindOf('foto.heic', false)).toBe('Immagine HEIC')
  expect(kindOf('dati.xyz', false)).toBe('File XYZ')
  expect(kindOf('Makefile', false)).toBe('File')
  expect(kindOf('.zshrc', false)).toBe('File') // a dot file has no extension
  expect(kindOf('Documenti', true)).toBe('Cartella')
  expect(kindOf('Safari.app', true)).toBe('Applicazione')
})

test('folder summary: counts, the size of the files right here, hidden ones', () => {
  expect(folderSummary([d('a'), d('b'), f('x', 1500), f('y', 500)], 3)).toBe('2 cartelle, 2 file · 2 KB · 3 nascosti')
  expect(folderSummary([d('a')], 0)).toBe('1 cartella, 0 file')
  expect(folderSummary([f('x')], 0)).toBe('0 cartelle, 1 file') // a listing without sizes
})

test('selection summary', () => {
  expect(selectionSummary([f('x', 2_000_000), f('y', 500_000)])).toBe('2 elementi selezionati · 2,5 MB')
  expect(selectionSummary([f('x', 1000), d('a')])).toBe('2 elementi selezionati (1 file, 1 cartella) · 1 KB nei file')
  expect(selectionSummary([d('a'), d('b')])).toBe('2 elementi selezionati')
})

test('df and du output', () => {
  const df = 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 482797652 350000000 120000000 75% /System/Volumes/Data\n'
  expect(parseDf(df)).toEqual({ total: 482797652 * 1024, free: 120000000 * 1024 })
  expect(parseDf('')).toBeNull()
  expect(parseDf('header only\n')).toBeNull()
  expect(parseDu('2048\t/Users/x/Documenti\n')).toBe(2048 * 1024)
  expect(parseDu('du: cannot read')).toBeNull()
  expect(diskSummary({ free: 120e9, total: 494e9 })).toBe('120 GB liberi su 494 GB')
})
