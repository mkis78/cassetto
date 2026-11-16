import { cp, link, lstat, mkdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import type { FileOp, OpResult } from '../shared/types'
import { shQuote, sshRun } from './ssh'

// Nothing here overwrites unless an item says replace: an existing name fails with this.
const EXISTS = 'Esiste già'

const exists = (p: string) => lstat(p).then(() => true, () => false)
// two names for one file: a case-only rename on a case-insensitive disk (macOS)
const same = (a: string, b: string) => Promise.all([lstat(a), lstat(b)]).then(([x, y]) => x.dev === y.dev && x.ino === y.ino, () => false)

// one step per path; a failure is recorded and the rest go on
async function each(steps: [string, () => Promise<unknown>][]): Promise<OpResult> {
  const failed: OpResult['failed'] = []
  for (const [path, step] of steps) {
    try {
      await step()
    } catch (e) {
      failed.push({ path, error: (e as Error).message })
    }
  }
  return { failed }
}

const fresh = async (p: string) => {
  if (await exists(p)) throw new Error(EXISTS)
}

// src to dest without ever replacing what is there: the new name is claimed first, atomically
// (mkdir for a folder, which rename then takes over since it is empty; a hard link for a file)
async function place(src: string, dest: string): Promise<void> {
  const claim = (e: unknown) => {
    throw (e as NodeJS.ErrnoException).code === 'EEXIST' ? new Error(EXISTS) : e
  }
  const st = await lstat(src)
  if (st.isDirectory()) {
    await mkdir(dest).catch(claim)
    return rename(src, dest).catch(async e => {
      await rmdir(dest).catch(() => {})
      throw e
    })
  }
  // ponytail: a symlink (macOS link() follows it) or a disk without hard links falls back to check-then-rename
  const linked = st.isSymbolicLink() ? false : await link(src, dest).then(() => true, e => ((e as NodeJS.ErrnoException).code === 'EEXIST' ? claim(e) : false))
  if (linked) return unlink(src)
  await fresh(dest)
  return rename(src, dest)
}

// errorOnExist + force:false: cp itself refuses to write over something that appeared after our check
const copy = (src: string, dest: string) => cp(src, dest, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })

export function runOpLocal(op: FileOp, trash: (p: string) => Promise<void>): Promise<OpResult> {
  switch (op.op) {
    case 'mkdir':
      return each([[op.path, () => fresh(op.path).then(() => mkdir(op.path))]])
    case 'touch':
      return each([[op.path, () => fresh(op.path).then(() => writeFile(op.path, '', { flag: 'wx' }))]])
    case 'rename':
      return each([[op.from, async () => ((await same(op.from, op.to)) ? rename(op.from, op.to) : place(op.from, op.to))]])
    case 'copy':
    case 'move':
      return each(
        op.items.map(({ src, dest, replace }) => [
          src,
          async () => {
            if (replace && (await exists(dest))) await trash(dest)
            if (op.op === 'copy') return fresh(dest).then(() => copy(src, dest))
            try {
              await place(src, dest)
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
              await copy(src, dest) // another volume: copy, then the original goes to the trash
              await trash(src).catch(t => {
                throw new Error(`Copiato, ma l'originale non è stato spostato nel Cestino: ${(t as Error).message}`)
              })
            }
          }
        ])
      )
    case 'trash':
      return each(op.paths.map(p => [p, () => trash(p)]))
    case 'delete':
      return each(op.paths.map(p => [p, () => rm(p, { recursive: true })]))
  }
}

// The same rules as sh, for a host: one line per item, reporting O<path>\0 or E<path>\0<error>\0.
// ponytail: mv and cp -R still check, then act; mkdir and touch (noclobber) claim the name atomically
export function remoteOpScript(op: FileOp): string {
  const q = shQuote
  const ok = (p: string) => `printf 'O%s\\0' ${q(p)}`
  const err = (p: string, e: string) => `printf 'E%s\\0%s\\0' ${q(p)} ${e}`
  const taken = (p: string) => `{ [ -e ${q(p)} ] || [ -L ${q(p)} ]; }`
  // run `cmd`, unless `guard` names a path that already exists
  const step = (p: string, cmd: string, guard?: string) =>
    `${guard ? `if ${guard === p ? '' : `! [ ${q(p)} -ef ${q(guard)} ] && `}${taken(guard)}; then ${err(p, q(EXISTS))}; el` : ''}if e=$(${cmd} 2>&1); then ${ok(p)}; else ${err(p, '"$e"')}; fi`
  switch (op.op) {
    case 'mkdir':
      return step(op.path, `mkdir -- ${q(op.path)}`, op.path)
    case 'touch':
      return step(op.path, `set -C; : > ${q(op.path)}`, op.path)
    case 'rename':
      return step(op.from, `mv -- ${q(op.from)} ${q(op.to)}`, op.to)
    case 'copy':
    case 'move': {
      const cmd = op.op === 'copy' ? 'cp -R --' : 'mv --'
      return op.items
        .map(({ src, dest, replace }) =>
          replace ? step(src, `rm -rf -- ${q(dest)} && ${cmd} ${q(src)} ${q(dest)}`) : step(src, `${cmd} ${q(src)} ${q(dest)}`, dest)
        )
        .join('\n')
    }
    case 'trash':
      return op.paths.map(p => err(p, q('Sul server non c\'è un Cestino'))).join('\n')
    case 'delete':
      return op.paths.map(p => step(p, `rm -rf -- ${q(p)}`)).join('\n')
  }
}

export function parseOpOutput(out: string): OpResult {
  const parts = out.split('\0')
  const failed: OpResult['failed'] = []
  for (let i = 0; i < parts.length; i++) if (parts[i][0] === 'E') failed.push({ path: parts[i].slice(1), error: (parts[++i] ?? '').trim() })
  return { failed }
}

// every path the op touches, for when ssh itself fails
const pathsOf = (op: FileOp): string[] => ('items' in op ? op.items.map(i => i.src) : 'paths' in op ? op.paths : 'from' in op ? [op.from] : [op.path])

export async function runOpRemote(host: string, op: FileOp): Promise<OpResult> {
  const r = await sshRun(host, remoteOpScript(op), { timeout: 10 * 60_000 })
  // ssh may have dropped halfway: some items may be done, so the report says so instead of calling them all failed
  return r.ok ? parseOpOutput(r.out.toString()) : { failed: pathsOf(op).map(path => ({ path, error: `${r.error} (esito incerto: aggiorna per vedere cosa è cambiato)` })) }
}
