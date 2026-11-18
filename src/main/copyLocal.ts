import { constants, createReadStream } from 'node:fs'
import { chmod, copyFile, lstat, mkdir, open, readdir, readlink, rm, symlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Trashed } from '../shared/types'
import type { JobItem, JobSpec } from '../shared/jobs'
import type { Progress } from './jobs'
import { exists, place, taken } from './fileOps'
import { t } from '../shared/i18n'

// below this a file is copied whole (a clone on APFS, instant); above it streamed, so its bytes show as they pass
const BIG = 64 * 1024 * 1024

// bytes of the regular files under p, symlinks not followed; a missing path counts 0 (its copy reports the error)
async function size(p: string, signal: AbortSignal): Promise<number> {
  signal.throwIfAborted()
  const st = await lstat(p).catch(() => null)
  if (!st?.isDirectory()) return st?.isFile() ? st.size : 0
  let n = 0
  for (const e of await readdir(p).catch(() => [])) n += await size(join(p, e), signal)
  return n
}

// s to d, every name claimed atomically so nothing is ever overwritten; `claimed` runs once d is ours.
// Folder modes are collected in `modes`, applied once the whole item is done: a read-only folder still takes its
// contents, and a partial item can still be removed.
async function copyTree(s: string, d: string, p: Progress, signal: AbortSignal, modes: [string, number][], claimed = () => {}): Promise<void> {
  signal.throwIfAborted()
  const st = await lstat(s)
  if (st.isDirectory()) {
    await mkdir(d).catch(taken)
    claimed()
    modes.push([d, st.mode])
    for (const e of await readdir(s)) await copyTree(join(s, e), join(d, e), p, signal, modes)
    return
  }
  if (st.isSymbolicLink()) return symlink(await readlink(s), d).then(claimed, taken)
  // a FIFO would block open forever, past any cancel; sockets and devices are not content either
  if (!st.isFile()) throw new Error(t('Tipo di file non supportato'))
  if (st.size < BIG) {
    await copyFile(s, d, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE).catch(taken)
    claimed()
    return p.add(st.size)
  }
  const out = await open(d, 'wx').catch(taken)
  claimed()
  const count = new Transform({
    transform(chunk: Buffer, _, next) {
      p.add(chunk.length)
      next(null, chunk)
    }
  })
  await pipeline(createReadStream(s), count, out.createWriteStream(), { signal })
  await chmod(d, st.mode)
}

// A same-host local copy or move, item by item. Never overwrites: replaced destinations go to the Trash first, all together.
// A failed item is reported and its partial destination removed; a cancel does the same for the current item and throws
// an AbortError carrying `done` and `trashed` (the items finished before it stay, and can be undone).
export async function copyLocal(spec: JobSpec, p: Progress, signal: AbortSignal, trashAll: (paths: string[]) => Promise<Trashed[]>): Promise<{ done: JobItem[]; trashed: Trashed[] }> {
  let done: JobItem[] = []
  const trashed: Trashed[] = []
  const trash = async (paths: string[]) => {
    const r = await trashAll(paths)
    trashed.push(...r.filter(x => !x.error))
    return r
  }
  const crossed: string[] = [] // moved to another volume by copying: the originals go to the Trash at the end
  try {
    try {
      const sizes = await Promise.all(spec.items.map(i => size(i.src, signal)))
      p.total(sizes.reduce((a, b) => a + b, 0))
      const old = (await Promise.all(spec.items.map(async i => (i.replace && (await exists(i.dest)) ? i.dest : '')))).filter(Boolean)
      const refused = new Map((old.length ? await trash(old) : []).flatMap(x => (x.error ? [[x.path, x.error] as const] : [])))
      for (const [k, i] of spec.items.entries()) {
        signal.throwIfAborted()
        p.item(basename(i.src))
        let mine = false
        const claimed = () => (mine = true)
        const modes: [string, number][] = []
        try {
          const no = refused.get(i.dest)
          if (no !== undefined) throw new Error(no)
          if (spec.op === 'copy') await copyTree(i.src, i.dest, p, signal, modes, claimed)
          else
            try {
              await place(i.src, i.dest)
              p.add(sizes[k])
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
              await copyTree(i.src, i.dest, p, signal, modes, claimed)
            }
          for (const [d, m] of modes.reverse()) await chmod(d, m) // innermost first
          if (mine && spec.op === 'move') crossed.push(i.src) // copied across volumes: the original goes only once the copy is whole
          done.push(i)
        } catch (e) {
          if (mine) await rm(i.dest, { recursive: true, force: true }).catch(() => {})
          if (signal.aborted) throw e
          p.fail(i.src, (e as Error).message)
        }
      }
    } finally {
      for (const x of crossed.length ? await trash(crossed) : [])
        if (x.error) {
          p.fail(x.path, t("Copiato, ma l'originale non è stato spostato nel Cestino: {error}", { error: x.error }))
          done = done.filter(i => i.src !== x.path) // not undoable as a move: the original is still there
        }
    }
  } catch (e) {
    throw Object.assign(e as object, { done, trashed })
  }
  return { done, trashed }
}
