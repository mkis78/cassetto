import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { runOpLocal } from '../src/main/fileOps'
import { inverseOf, runUndo, removeIfSameScript, stampScript, UndoStack, type UndoDeps, type UndoRecord } from '../src/main/undo'
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
const deps: UndoDeps = { local, remote: none, script: none }
const inv = (host: string | null, op: FileOp, failed: string[] = [], trashed: Trashed[] = [], stamps = new Map<string, string>()) => inverseOf(host, op, new Set(failed), trashed, stamps)

describe('inverseOf', () => {
  test('extract is undone like a created folder', () => {
    const op: FileOp = { op: 'extract', archive: '/d/a.zip', dest: '/d/a' }
    expect(inv(null, op)).toEqual({ host: null, label: 'Estratto «a»', steps: [{ kind: 'trash', path: '/d/a' }] })
    expect(inv('h', op, [], [], new Map([['/d/a', 's']]))!.steps).toEqual([{ kind: 'removeIfSame', path: '/d/a', stamp: 's' }])
    expect(inv(null, op, ['/d/a'])).toBeNull()
  })
  test('rename', () => {
    expect(inv(null, { op: 'rename', from: '/d/a', to: '/d/b' })).toEqual({ host: null, label: 'Rinominato «a»', steps: [{ kind: 'move', from: '/d/b', to: '/d/a' }] })
  })
  test('renameMany: the pairs reversed, only when nothing failed', () => {
    const items = [{ from: '/d/a', to: '/d/b' }, { from: '/d/b', to: '/d/a' }]
    expect(inv(null, { op: 'renameMany', items })).toEqual({ host: null, label: 'Rinominati 2 elementi', steps: [{ kind: 'renameMany', items: [{ from: '/d/b', to: '/d/a' }, { from: '/d/a', to: '/d/b' }] }] })
    expect(inv('h', { op: 'renameMany', items: items.slice(0, 1) })!.label).toBe('Rinominato «a»')
    expect(inv(null, { op: 'renameMany', items }, ['/d/a'])).toBeNull()
    expect(inv(null, { op: 'renameMany', items: [] })).toBeNull()
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
    expect(inv('h', { op: 'mkdir', path: '/d/f' })!.steps).toEqual([{ kind: 'rmdir', path: '/d/f' }])
    expect(inv('h', { op: 'touch', path: '/d/f' })).toBeNull() // no stamp, no way to check it later
    expect(inv('h', { op: 'copy', items: [{ src: '/s/a', dest: '/d/a', replace: false }] }, [], [], new Map([['/d/a', 'T']]))!.steps).toEqual([{ kind: 'removeIfSame', path: '/d/a', stamp: 'T' }])
  })
  test('a replaced item with no known Trash path is reported, not forgotten', () => {
    const op: FileOp = { op: 'copy', items: [{ src: '/s/a', dest: '/d/a', replace: true }] }
    expect(inv(null, op, [], [{ path: '/d/a' }])!.steps[0]).toEqual({ kind: 'move', from: '', to: '/d/a', fromTrash: true })
  })
  test('a cross-volume move (original trashed) is undone from the Trash', () => {
    const op: FileOp = { op: 'move', items: [{ src: '/s/a', dest: '/d/a', replace: false }] }
    expect(inv(null, op, [], [{ path: '/s/a', trashed: '/bin/a' }])!.steps).toEqual([{ kind: 'move', from: '/bin/a', to: '/s/a', fromTrash: true, trash: '/d/a' }])
  })
  test('trash moves each item back, even one without a Trash path', () => {
    const r = inv(null, { op: 'trash', paths: ['/d/a', '/d/b'] }, [], [{ path: '/d/a', trashed: '/bin/a' }])!
    expect(r.steps).toEqual([{ kind: 'move', from: '/bin/a', to: '/d/a', fromTrash: true }, { kind: 'move', from: '', to: '/d/b', fromTrash: true }])
  })
  test('delete is not undoable', () => expect(inv(null, { op: 'delete', paths: ['/d/a'] })).toBeNull())
})

test('stampScript quotes the path', () => expect(stampScript("/d/it's")).toContain(`find -- '/d/it'\\''s' -exec`))
test('a stamp is a fixed-size checksum, empty for a missing path', () => {
  const d = dir()
  for (let i = 0; i < 50; i++) writeFileSync(join(d, `file-${i}`), String(i))
  expect(execFileSync('/bin/sh', ['-c', stampScript(d)]).toString().trim()).toMatch(/^\d+ \d+$/)
  expect(execFileSync('/bin/sh', ['-c', `${stampScript(join(d, 'none'))}; true`]).toString()).toBe('')
})

describe('runUndo', () => {
  const undoOf = async (op: FileOp) => {
    const res = await local(op)
    return inverseOf(null, op, new Set(res.failed.map(f => f.path)), res.trashed, new Map())!
  }
  test('undo of a swap restores both names', async () => {
    const d = dir()
    const [a, b] = [join(d, 'a'), join(d, 'b')]
    writeFileSync(a, 'A')
    writeFileSync(b, 'B')
    const rec = await undoOf({ op: 'renameMany', items: [{ from: a, to: b }, { from: b, to: a }] })
    expect(readFileSync(a, 'utf8')).toBe('B')
    expect(await runUndo(rec, deps)).toEqual({ label: 'Rinominati 2 elementi', failed: [], retry: false, dirs: [d] })
    expect([readFileSync(a, 'utf8'), readFileSync(b, 'utf8')]).toEqual(['A', 'B'])
  })
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
  // the remote scripts, run by the local sh
  const sh = async (_h: string, script: string) => execFileSync('/bin/sh', ['-c', script]).toString().trim()
  const shDeps: UndoDeps = { ...deps, script: sh }
  const stampNow = async (p: string) => (await sh('h', stampScript(p))).replace(/\n+$/, '')
  test('remote undo removes an unchanged copy, refuses a changed one', async () => {
    const d = dir()
    const f = join(d, 'f')
    writeFileSync(f, 'one')
    const rec: UndoRecord = { host: 'h', label: 'x', steps: [{ kind: 'removeIfSame', path: f, stamp: await stampNow(f) }] }
    writeFileSync(f, 'changed!')
    expect(await runUndo(rec, shDeps)).toMatchObject({ failed: [{ path: f, error: "Modificato dopo l'operazione: non rimosso" }] })
    expect(existsSync(f)).toBe(true)
    rec.steps = [{ kind: 'removeIfSame', path: f, stamp: await stampNow(f) }]
    expect((await runUndo(rec, shDeps)).failed).toEqual([])
    expect(existsSync(f)).toBe(false)
    expect((await runUndo(rec, shDeps)).failed).toEqual([{ path: f, error: 'Non trovato' }]) // missing: empty stamp is not a match
  })
  test('the removal script checks and removes in one go', async () => {
    const d = dir()
    writeFileSync(join(d, 'f'), 'x')
    expect(await sh('h', removeIfSameScript(join(d, 'f'), 'nope'))).toBe('changed')
    expect(existsSync(join(d, 'f'))).toBe(true)
  })
  test('remote undo of mkdir refuses a folder that got content', async () => {
    const d = dir()
    mkdirSync(join(d, 'n'))
    const rec: UndoRecord = { host: 'h', label: 'x', steps: [{ kind: 'rmdir', path: join(d, 'n') }] }
    writeFileSync(join(d, 'n', 'f'), 'x')
    expect((await runUndo(rec, shDeps)).failed).toHaveLength(1)
    expect(existsSync(join(d, 'n', 'f'))).toBe(true)
    rmSync(join(d, 'n', 'f'))
    expect((await runUndo(rec, shDeps)).failed).toEqual([])
    expect(existsSync(join(d, 'n'))).toBe(false)
  })
  test('undo of a cross-volume move takes the original back from the Trash', async () => {
    const d = dir()
    const [s, t] = [join(d, 's'), join(d, 't')]
    writeFileSync(s, 'src')
    writeFileSync(t, 'src')
    const trashed = await fakeTrash([s]) // what the EXDEV path did: dest copied, src trashed
    const rec = inverseOf(null, { op: 'move', items: [{ src: s, dest: t, replace: false }] }, new Set(), trashed, new Map())!
    expect((await runUndo(rec, deps)).failed).toEqual([])
    expect(readFileSync(s, 'utf8')).toBe('src')
    expect(existsSync(t)).toBe(false)
  })
  test('a cross-volume move whose original cannot come back keeps the copy', async () => {
    const d = dir()
    const [s, t, u, v] = [join(d, 's'), join(d, 't'), join(d, 'u'), join(d, 'v')]
    writeFileSync(t, 'src')
    const move = (src: string, dest: string): FileOp => ({ op: 'move', items: [{ src, dest, replace: false }] })
    // Trash path unknown
    const unknown = inverseOf(null, move(s, t), new Set(), [{ path: s }], new Map())!
    expect((await runUndo(unknown, deps)).failed).toEqual([{ path: s, error: 'Non trovato nel Cestino' }])
    expect(readFileSync(t, 'utf8')).toBe('src')
    // the original's name is taken again
    writeFileSync(u, 'orig')
    const trashed = await fakeTrash([u])
    writeFileSync(u, 'new')
    writeFileSync(v, 'orig')
    const taken = inverseOf(null, move(u, v), new Set(), trashed, new Map())!
    expect((await runUndo(taken, deps)).failed).toEqual([{ path: u, error: 'Esiste già' }])
    expect(readFileSync(v, 'utf8')).toBe('orig')
    expect(existsSync(trashed[0].trashed!)).toBe(true)
  })
})

describe('retry: only a record that failed whole because ssh failed', () => {
  const down = () => Promise.reject(new Error('ssh: host down'))
  const remoteRec: UndoRecord = { host: 'h', label: 'x', steps: [{ kind: 'move', from: '/d/b', to: '/d/a' }, { kind: 'rmdir', path: '/d/n' }] }
  test('a remote record whose ssh call throws for every step is retried', async () => {
    const r = await runUndo(remoteRec, { local: none, remote: down, script: down })
    expect(r.failed).toHaveLength(2)
    expect(r.retry).toBe(true)
  })
  test('a remote record with a lasting failure is not', async () => {
    const r = await runUndo(remoteRec, { local: none, remote: down, script: async () => 'missing' })
    expect(r.retry).toBe(false)
  })
  test('a local record whose items are gone from the Trash is not', async () => {
    const rec = inverseOf(null, { op: 'trash', paths: ['/d/a', '/d/b'] }, new Set(), [], new Map())!
    const r = await runUndo(rec, deps)
    expect(r.failed.map(f => f.error)).toEqual(['Non trovato nel Cestino', 'Non trovato nel Cestino'])
    expect(r.retry).toBe(false)
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
