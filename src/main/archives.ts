import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { lstat, mkdir, readdir, readlink, rename, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { extractCommand } from './fileOps'
import { shQuote } from './ssh'

export const cacheKey = (host: string | null, path: string, size: number, mtimeMs: number): string =>
  createHash('sha1').update(`${host ?? ''}\0${path}\0${size}\0${mtimeMs}`).digest('hex')

// who is looking at which cache: a cache goes away when its last holder lets go
export class ArchiveCaches {
  private held = new Map<string, { host: string | null; holders: Set<string> }>()
  constructor(private deps: { base: string; remove: (host: string | null, root: string) => Promise<void> }) {}

  acquire(host: string | null, root: string, holder: string): void {
    const c = this.held.get(root) ?? { host, holders: new Set<string>() }
    c.holders.add(holder)
    this.held.set(root, c)
  }

  async release(holder: string, root?: string): Promise<void> {
    const gone: [string | null, string][] = []
    for (const [r, c] of this.held) {
      if ((root !== undefined && r !== root) || !c.holders.delete(holder) || c.holders.size) continue
      this.held.delete(r)
      gone.push([c.host, r])
    }
    await Promise.all(gone.map(([h, r]) => this.deps.remove(h, r).catch(() => {})))
  }

  async releaseAll(): Promise<void> {
    const all = [...this.held]
    this.held.clear()
    await Promise.all(all.map(([r, c]) => this.deps.remove(c.host, r).catch(() => {})))
  }

  holders(root: string): number {
    return this.held.get(root)?.holders.size ?? 0
  }
}

// removes the symlinks that point out of `root` (an absolute target, or one that climbs out); never follows a link
export async function pruneLinks(root: string): Promise<number> {
  let n = 0
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir)) {
      const p = join(dir, e)
      const st = await lstat(p)
      if (st.isDirectory()) await walk(p)
      else if (st.isSymbolicLink()) {
        const target = await readlink(p)
        // ponytail: any `..` segment goes, even one that stays inside; a chain of links (q -> ., x -> q/q/../..) defeats a lexical check
        if (isAbsolute(target) || target.split(/[\\/]/).includes('..')) {
          await rm(p, { force: true })
          n++
        }
      }
    }
  }
  await walk(root)
  return n
}

// extracts `archive` into base/<key> (reused when already there); a failure leaves nothing behind
// ponytail: two opens of the same archive at once race on the .partial folder; the renderer opens one per holder
export async function openLocal(base: string, archive: string, signal: AbortSignal): Promise<{ root: string; hidden: number }> {
  const st = await stat(archive)
  const root = join(base, cacheKey(null, archive, st.size, st.mtimeMs))
  if (await lstat(root).then(() => true, () => false)) return { root, hidden: 0 }
  const partial = root + '.partial'
  try {
    await mkdir(partial, { recursive: true })
    const [cmd, args] = extractCommand(process.platform, archive, partial)
    const child = promisify(execFile)(cmd, args, { signal })
    child.child.stdin?.end() // nothing to answer a prompt: it fails instead of waiting
    await child
    const hidden = await pruneLinks(partial)
    await rename(partial, root)
    return { root, hidden }
  } catch (e) {
    await rm(partial, { recursive: true, force: true }).catch(() => {})
    throw new Error(((e as { stderr?: string }).stderr || (e as Error).message).trim())
  }
}

// the cache dir is named by main so a cancel can remove it
export const remoteCacheDir = (): string => `/tmp/cassetto-archive-${randomBytes(8).toString('hex')}`

// a root main may delete: its own cache folder locally, a cassetto-archive dir in /tmp on a host
export const ownedCache = (host: string | null, root: string, base: string): boolean =>
  host ? /^\/tmp\/cassetto-archive-[A-Za-z0-9]+$/.test(root) : resolve(root) === root && dirname(root) === base // not `<base>/..` or `<base>/.`

// extracts into `d`, prints <links removed>; a failed extraction removes the dir and exits non-zero
export function remoteOpenScript(archive: string, d: string): string {
  const a = shQuote(archive)
  const tar = `tar -xf ${a} -C "$d"`
  const run = /\.zip$/i.test(archive) ? `unzip -q -o -- ${a} -d "$d" || ${tar}` : tar
  return [
    `d=${shQuote(d)}`,
    `mkdir -m 700 -- "$d" || exit 1`,
    `{ ${run}; } || { rm -rf -- "$d"; exit 1; }`,
    `n=$(find "$d" -type l | while IFS= read -r l; do case $(readlink "$l") in (/*|*..*) rm -f -- "$l"; echo x;; esac; done | wc -l)`,
    `printf '%s' "$((n))"`
  ].join('\n')
}

export async function sweep(base: string): Promise<void> {
  const names = await readdir(base).catch(() => [])
  await Promise.all(names.map(n => rm(join(base, n), { recursive: true, force: true })))
}
