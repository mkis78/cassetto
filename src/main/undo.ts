import { lstat } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { FileOp, OpResult, Trashed, UndoResult } from '../shared/types'
import { shQuote } from './ssh'
import { t } from '../shared/i18n'

// fromTrash: the source is an item in the Trash, so a missing one is reported as such
export type Step = { kind: 'move'; from: string; to: string; fromTrash?: boolean } | { kind: 'trash'; path: string } | { kind: 'removeIfSame'; path: string; stamp: string }
export type UndoRecord = { host: string | null; label: string; steps: Step[] }

// what a remote copy looks like, to tell later whether anyone touched it
export const stampScript = (path: string): string => `find -- ${shQuote(path)} -exec sh -c 'stat -c "%n %s %Y" -- "$@" 2>/dev/null || stat -f "%N %z %m" -- "$@"' _ {} + | sort`

// the label for n items: one name, or a count
const named = (n: number, name: string, one: string, many: string) => (n === 1 ? t(one, { name }) : t(many, { n }))

// What undoes `op`, given what it did: null when nothing happened or it cannot be undone.
// Steps are listed in the order the op did them; runUndo runs them backwards.
export function inverseOf(host: string | null, op: FileOp, failed: Set<string>, trashed: Trashed[], stamps: Map<string, string>): UndoRecord | null {
  const rec = (label: string, steps: Step[]): UndoRecord | null => (steps.length ? { host, label, steps } : null)
  const created = (p: string): Step[] => {
    if (!host) return [{ kind: 'trash', path: p }]
    const stamp = stamps.get(p)
    return stamp === undefined ? [] : [{ kind: 'removeIfSame', path: p, stamp }]
  }
  switch (op.op) {
    case 'delete':
      return null
    case 'rename':
      return failed.has(op.from) ? null : rec(t('Rinominato «{name}»', { name: basename(op.from) }), [{ kind: 'move', from: op.to, to: op.from }])
    case 'mkdir':
    case 'touch':
      return failed.has(op.path) ? null : rec(t('Creato «{name}»', { name: basename(op.path) }), created(op.path))
    case 'copy':
    case 'move': {
      if (host && op.items.some(i => i.replace)) return null // ponytail: a remote replace deletes for good, there is nothing to bring back
      const items = op.items.filter(i => !failed.has(i.src))
      const steps = items.flatMap((i): Step[] => {
        const old = i.replace ? trashed.find(x => x.path === i.dest && x.trashed) : undefined
        const back: Step[] = old ? [{ kind: 'move', from: old.trashed!, to: i.dest, fromTrash: true }] : []
        return [...back, ...(op.op === 'copy' ? created(i.dest) : [{ kind: 'move' as const, from: i.dest, to: i.src }])]
      })
      const name = items[0] ? basename(items[0].src) : ''
      return rec(op.op === 'copy' ? named(items.length, name, 'Copiato «{name}»', 'Copiati {n} elementi') : named(items.length, name, 'Spostato «{name}»', 'Spostati {n} elementi'), steps)
    }
    case 'trash': {
      const paths = op.paths.filter(p => !failed.has(p))
      const steps = paths.map((p): Step => ({ kind: 'move', from: trashed.find(x => x.path === p)?.trashed ?? '', to: p, fromTrash: true }))
      return rec(named(paths.length, basename(paths[0] ?? ''), 'Spostato nel Cestino «{name}»', 'Spostati nel Cestino {n} elementi'), steps)
    }
  }
}

export class UndoStack {
  private items: UndoRecord[] = []
  push(r: UndoRecord): void {
    this.items.push(r)
    if (this.items.length > 50) this.items.shift()
  }
  pop = () => this.items.pop()
  peek = () => this.items[this.items.length - 1]
}

const exists = (p: string) => lstat(p).then(() => true, () => false)

export interface UndoDeps {
  local: (op: FileOp) => Promise<OpResult & { trashed: Trashed[] }>
  remote: (host: string, op: FileOp) => Promise<OpResult>
  stamp: (host: string, path: string) => Promise<string | null>
  remove: (host: string, path: string) => Promise<OpResult>
}

// Never overwrites: a step whose name is taken or whose source is gone is reported, the others go on.
export async function runUndo(r: UndoRecord, deps: UndoDeps): Promise<NonNullable<UndoResult>> {
  const failed: { path: string; error: string }[] = []
  const touched: string[] = []
  const fail = (path: string, error: string) => failed.push({ path, error })
  const trashes = r.steps.flatMap(s => (s.kind === 'trash' ? [s.path] : []))
  if (trashes.length) {
    touched.push(...trashes)
    failed.push(...(await deps.local({ op: 'trash', paths: trashes })).failed)
  }
  for (const s of [...r.steps].reverse()) {
    if (s.kind === 'trash') continue
    if (s.kind === 'move') {
      touched.push(s.from, s.to)
      if (s.fromTrash && (!s.from || !(await exists(s.from)))) {
        fail(s.to, t('Non trovato nel Cestino'))
        continue
      }
      const op: FileOp = { op: 'rename', from: s.from, to: s.to }
      const res = r.host ? await deps.remote(r.host, op) : await deps.local(op)
      failed.push(...res.failed.map(f => ({ path: s.to, error: f.error })))
    } else {
      touched.push(s.path)
      const now = await deps.stamp(r.host!, s.path)
      if (now === null) fail(s.path, t('Non trovato'))
      else if (now !== s.stamp) fail(s.path, t("Modificato dopo l'operazione: non rimosso"))
      else failed.push(...(await deps.remove(r.host!, s.path)).failed)
    }
  }
  return { label: r.label, failed, dirs: [...new Set(touched.filter(Boolean).map(p => dirname(p)))] }
}
