import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { runOpLocal } from '../src/main/fileOps'
import { inverseOf, runUndo, stampScript, UndoStack, type UndoDeps, type UndoRecord } from '../src/main/undo'
import type { FileOp, Trashed } from '../src/shared/types'

const dir = () => mkdtempSync(join(tmpdir(), 'tundo-'))
const bin = dir()
const fakeTrash = async (ps: string[]): Promise<Trashed[]> =>
  ps.map(p => {
    const to = join(bin, basename(p) + Math.random())
    renameSync(p, to)
    return { path: p, trashed: to }
  })
const local = (op: FileOp) => runOpLocal(op, fakeTrash)
const none = () => Promise.reject(new Error('unused'))
const deps: UndoDeps = { local, remote: none, stamp: none, remove: none }
const inv = (host: string | null, op: FileOp, failed: string[] = [], trashed: Trashed[] = [], stamps = new Map<string, string>()) => inverseOf(host, op, new Set(failed), trashed, stamps)

describe('inverseOf', () => {
  test('rename', () => {
    expect(inv(null, { op: 'rename', from: '/d/a', to: '/d/b' })).toEqual({ host: null, label: 'Rinominato «a»', steps: [{ kind: 'move', from: '/d/b', to: '/d/a' }] })
  })
  test('move skips failed items and counts the rest', () => {
    const items = ['a', 'b', 'c'].map(n => ({ src: `/s/${n}`, dest: `/d/${n}`, replace: false }))
    const r = inv(null, { op: 'move', items }, ['/s/b'])!
    expect(r.label).toBe('Spostati 2 elementi')
    expect(r.steps).toEqual([{ kind: 'move', from: '/d/a', to: '/s/a' }, { kind: 'move', from: '/d/c', to: '/s/c' }])
    expect(inv(null, { op: 'move', items: items.slice(0, 1) })!.label).toBe('Spostato «a»')
  })
  test('labels of the other ops', () => {
    expect(inv(null, { op: 'mkdir', path: '/d/n' })!.label).toBe('Creato «n»')
    const items = ['a', 'b'].map(n => ({ src: `/s/${n}`, dest: `/d/${n}`, replace: false }))
    expect(inv(null, { op: 'copy', items })!.label).toBe('Copiati 2 elementi')
    expect(inv(null, { op: 'copy', items: items.slice(0, 1) })!.label).toBe('Copiato «a»')
    expect(inv(null, { op: 'trash', paths: ['/d/a'] }, [], [{ path: '/d/a', trashed: '/bin/a' }])!.label).toBe('Spostato nel Cestino «a»')
    expect(inv(null, { op: 'trash', paths: ['/d/a', '/d/b'] })!.label).toBe('Spostati nel Cestino 2 elementi')
  })
  test('move with replace brings back the replaced item locally, is not undoable remotely', () => {
    const op: FileOp = { op: 'move', items: [{ src: '/s/a', dest: '/d/a', replace: true }] }
    expect(inv(null, op, [], [{ path: '/d/a', trashed: '/bin/a1' }])!.steps).toEqual([
      { kind: 'move', from: '/bin/a1', to: '/d/a', fromTrash: true },
      { kind: 'move', from: '/d/a', to: '/s/a' }
    ])
    expect(inv('h', op)).toBeNull()
  })
  test('created things: trash locally, removeIfSame remotely', () => {
    expect(inv(null, { op: 'touch', path: '/d/f' })!.steps).toEqual([{ kind: 'trash', path: '/d/f' }])
    expect(inv('h', { op: 'mkdir', path: '/d/f' }, [], [], new Map([['/d/f', 'S']]))!.steps).toEqual([{ kind: 'removeIfSame', path: '/d/f', stamp: 'S' }])
    expect(inv('h', { op: 'copy', items: [{ src: '/s/a', dest: '/d/a', replace: false }] }, [], [], new Map([['/d/a', 'T']]))!.steps).toEqual([{ kind: 'removeIfSame', path: '/d/a', stamp: 'T' }])
  })
  test('trash moves each item back, even one without a Trash path', () => {
    const r = inv(null, { op: 'trash', paths: ['/d/a', '/d/b'] }, [], [{ path: '/d/a', trashed: '/bin/a' }])!
    expect(r.steps).toEqual([{ kind: 'move', from: '/bin/a', to: '/d/a', fromTrash: true }, { kind: 'move', from: '', to: '/d/b', fromTrash: true }])
  })
  test('delete is not undoable', () => expect(inv(null, { op: 'delete', paths: ['/d/a'] })).toBeNull())
})

test('stampScript quotes the path', () => expect(stampScript("/d/it's")).toContain(`find -- '/d/it'\\''s' -exec`))

describe('runUndo', () => {
  const undoOf = async (op: FileOp) => {
    const res = await local(op)
    return inverseOf(null, op, new Set(res.failed.map(f => f.path)), res.trashed, new Map())!
  }
  test('undo trash refuses when name is taken', async () => {
    const d = dir()
    const x = join(d, 'x')
    writeFileSync(x, 'old')
    const rec = await undoOf({ op: 'trash', paths: [x] })
    writeFileSync(x, 'new')
    const r = await runUndo(rec, deps)
    expect(r.failed).toEqual([{ path: x, error: 'Esiste già' }])
    expect(readFileSync(x, 'utf8')).toBe('new')
    expect(r.dirs).toContain(d)
  })
  test('undo trash reports an item gone from the trash', async () => {
    const d = dir()
    const [x, y] = [join(d, 'x'), join(d, 'y')]
    writeFileSync(x, '1')
    writeFileSync(y, '2')
    const rec = await undoOf({ op: 'trash', paths: [x, y] })
    rmSync((rec.steps[0] as { from: string }).from)
    const r = await runUndo(rec, deps)
    expect(r.failed).toEqual([{ path: x, error: 'Non trovato nel Cestino' }])
    expect(readFileSync(y, 'utf8')).toBe('2')
  })
  test('undo of a local copy trashes it; undo of a replacing move restores both', async () => {
    const d = dir()
    const [s, t] = [join(d, 's'), join(d, 't')]
    writeFileSync(s, 'src')
    writeFileSync(t, 'target')
    const rec = await undoOf({ op: 'move', items: [{ src: s, dest: t, replace: true }] })
    expect(await runUndo(rec, deps)).toMatchObject({ label: 'Spostato «s»', failed: [] })
    expect(readFileSync(s, 'utf8')).toBe('src')
    expect(readFileSync(t, 'utf8')).toBe('target')
    const c = await undoOf({ op: 'copy', items: [{ src: s, dest: join(d, 'c'), replace: false }] })
    await runUndo(c, deps)
    expect(existsSync(join(d, 'c'))).toBe(false)
  })
  test('remote undo refuses a changed copy', async () => {
    const remove = vi.fn()
    const rec: UndoRecord = { host: 'h', label: 'x', steps: [{ kind: 'removeIfSame', path: '/r/f', stamp: 'A' }] }
    const r = await runUndo(rec, { ...deps, stamp: async () => 'B', remove })
    expect(r.failed).toEqual([{ path: '/r/f', error: "Modificato dopo l'operazione: non rimosso" }])
    expect(remove).not.toHaveBeenCalled()
    const ok = vi.fn(async () => ({ failed: [] }))
    expect((await runUndo(rec, { ...deps, stamp: async () => 'A', remove: ok })).failed).toEqual([])
    expect(ok).toHaveBeenCalledWith('h', '/r/f')
  })
})

test('UndoStack keeps the last 50', () => {
  const s = new UndoStack()
  for (let i = 0; i < 60; i++) s.push({ host: null, label: String(i), steps: [] })
  expect(s.peek()?.label).toBe('59')
  let n = 0
  let last
  while (s.peek()) (last = s.pop()), n++
  expect(n).toBe(50)
  expect(last!.label).toBe('10')
})
