import { existsSync, mkdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { findTrashed, parseTrashInfo, trashItems } from '../src/main/platform/trash'

const dir = () => mkdtempSync(join(tmpdir(), 'ttrash-'))

describe('freedesktop trash', () => {
  test('parseTrashInfo reads the original path and the date', () => {
    expect(parseTrashInfo('[Trash Info]\nPath=/home/u/a%20b.txt\nDeletionDate=2026-11-17T10:00:00\n')).toEqual({ path: '/home/u/a b.txt', date: '2026-11-17T10:00:00' })
    expect(parseTrashInfo('garbage')).toBeNull()
  })

  test('findTrashed picks the newest deletion of that path', async () => {
    const d = dir()
    mkdirSync(join(d, 'info'))
    mkdirSync(join(d, 'files'))
    writeFileSync(join(d, 'info', 'x.trashinfo'), '[Trash Info]\nPath=/o/x\nDeletionDate=2026-11-17T10:00:00\n')
    writeFileSync(join(d, 'info', 'x.2.trashinfo'), '[Trash Info]\nPath=/o/x\nDeletionDate=2026-11-17T11:00:00\n')
    writeFileSync(join(d, 'files', 'x'), '')
    writeFileSync(join(d, 'files', 'x.2'), '')
    expect(await findTrashed('/o/x', [[d, '/']])).toBe(join(d, 'files', 'x.2'))
    expect(await findTrashed('/o/none', [[d, '/']])).toBeNull()
  })

  test('findTrashed skips an info without its file, and info files named after something else', async () => {
    const d = dir()
    mkdirSync(join(d, 'info'))
    mkdirSync(join(d, 'files'))
    writeFileSync(join(d, 'info', 'x.trashinfo'), '[Trash Info]\nPath=/o/x\nDeletionDate=2026-11-17T10:00:00\n')
    writeFileSync(join(d, 'files', 'x'), '')
    writeFileSync(join(d, 'info', 'x.3.trashinfo'), '[Trash Info]\nPath=/o/x\nDeletionDate=2026-11-17T12:00:00\n') // restored: no files/x.3
    writeFileSync(join(d, 'info', 'zz.trashinfo'), '[Trash Info]\nPath=/o/x\nDeletionDate=2026-11-17T13:00:00\n')
    writeFileSync(join(d, 'files', 'zz'), '')
    expect(await findTrashed('/o/x', [[d, '/']])).toBe(join(d, 'files', 'x'))
  })

  test.each([
    ['foo.tar.gz', 'foo.2.tar.gz'],
    ['.bashrc', '.2.bashrc']
  ])('findTrashed finds the newer duplicate of %s, named %s by gio', async (name, dup) => {
    const d = dir()
    mkdirSync(join(d, 'info'))
    mkdirSync(join(d, 'files'))
    writeFileSync(join(d, 'info', `${name}.trashinfo`), `[Trash Info]\nPath=/o/${name}\nDeletionDate=2026-11-17T10:00:00\n`)
    writeFileSync(join(d, 'info', `${dup}.trashinfo`), `[Trash Info]\nPath=/o/${name}\nDeletionDate=2026-11-17T11:00:00\n`)
    writeFileSync(join(d, 'files', name), '')
    writeFileSync(join(d, 'files', dup), '')
    expect(await findTrashed(`/o/${name}`, [[d, '/']])).toBe(join(d, 'files', dup))
  })

  test('findTrashed reads a Path relative to the mount top ($topdir/.Trash-$uid)', async () => {
    const top = dir()
    const d = join(top, '.Trash-501')
    mkdirSync(join(d, 'info'), { recursive: true })
    mkdirSync(join(d, 'files'))
    writeFileSync(join(d, 'info', 'x.trashinfo'), '[Trash Info]\nPath=sub/x\nDeletionDate=2026-11-17T10:00:00\n')
    writeFileSync(join(d, 'files', 'x'), '')
    expect(await findTrashed(join(top, 'sub', 'x'), [[d, top]])).toBe(join(d, 'files', 'x'))
  })
})

test.skipIf(process.platform !== 'darwin')('trash on darwin keeps odd names', async () => {
  const d = dir()
  const names = ['a b.txt', `it's "q".txt`, 'àè.txt', 'a\nb.txt']
  for (const n of names) writeFileSync(join(d, n), '')
  const r = await trashItems([...names.map(n => join(d, n)), join(d, 'missing')])
  expect(r).toHaveLength(5)
  r.slice(0, 4).forEach((x, i) => {
    expect(x.error).toBeUndefined()
    expect(existsSync(x.trashed!)).toBe(true)
    expect(basename(x.trashed!).normalize('NFC')).toContain(names[i].normalize('NFC').slice(0, 3))
    renameSync(x.trashed!, join(d, names[i]))
  })
  expect(r[4].path).toBe(join(d, 'missing'))
  expect(r[4].trashed).toBeUndefined()
  expect(r[4].error).toBeTruthy()
})
