import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { posix } from 'node:path'
import type { Trashed } from '../shared/types'
import type { JobSpec } from '../shared/jobs'
import type { Progress } from './jobs'
import { collect, kb, sizesScript } from './copyRemote'
import { EXISTS, exists, place } from './fileOps'
import { remoteSh, shQuote as q, sshOptions } from './ssh'
import { t } from '../shared/i18n'

// a machine (host null: this one) runs a script; each child leads its own process group, so a kill takes what it started too
export type Sides = { spawn(host: string | null, script: string): ChildProcess; trash(paths: string[]): Promise<Trashed[]> }

// COPYFILE_DISABLE: macOS tar adds no ._ files. BatchMode: as sshRunner
export const spawnSide = (host: string | null, script: string): ChildProcess =>
  host
    ? spawn('ssh', [...sshOptions(), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, '--', remoteSh(script)], { detached: true })
    : spawn('/bin/sh', ['-c', script], { detached: true, env: { ...process.env, COPYFILE_DISABLE: '1' } })

const killer = (c: ChildProcess) => () => {
  try {
    process.kill(-c.pid!)
  } catch {
    c.kill()
  }
}
const why = (...rs: { code: number; err: string }[]) => rs.map(r => r.err.trim()).find(Boolean) ?? `exit ${rs.find(r => r.code)?.code}`

// A copy or move between machines: per item, `tar -cf -` on the source piped through here, bytes counted, into `tar -xf -`
// in a fresh .cassetto-part-* folder next to the destination, then moved to its name without overwriting. Bytes and total
// are tar stream vs `du -sk`, so close, not exact. A failed item is reported and its part folder removed; a cancel kills
// both sides, removes the part folder and throws an AbortError. The source is removed (moves) only once its item is placed.
// ponytail: a crash leaves the .cassetto-part-* folder behind, visible, for the user to delete
export async function transfer(spec: JobSpec, p: Progress, signal: AbortSignal, sides: Sides): Promise<void> {
  const run = (host: string | null, script: string, s?: AbortSignal) => {
    const c = sides.spawn(host, script)
    c.stdin?.end()
    return collect(c, s, { kill: killer(c) })
  }
  const m = await run(spec.from, sizesScript(spec.items), signal)
  signal.throwIfAborted()
  p.total(m.code ? null : m.out.split('\n').reduce((a, l) => a + kb(l), 0))
  for (const i of spec.items) {
    signal.throwIfAborted()
    const name = posix.basename(i.src)
    p.item(name)
    const part = posix.join(posix.dirname(i.dest), `.cassetto-part-${randomBytes(4).toString('hex')}`)
    const clean = () => run(spec.to, `rm -rf -- ${q(part)}`)
    // a failing tar removes the part folder itself, after it is gone (a remote one may outlive our kill)
    const dst = sides.spawn(spec.to, `d=${q(part)}; mkdir -- "$d" || exit 1; tar -xf - --no-same-owner -C "$d" || { rm -rf -- "$d"; exit 1; }`)
    const src = sides.spawn(spec.from, `cd -- ${q(posix.dirname(i.src))} && ${spec.from ? 'COPYFILE_DISABLE=1 ' : ''}tar -cf - -- ${q(name)}`)
    src.stdin?.end()
    // the cancel, or either side failing, ends both
    const stop = new AbortController()
    const halt = () => stop.abort()
    signal.addEventListener('abort', halt, { once: true })
    let first = src
    for (const c of [src, dst]) c.on('exit', code => code !== 0 && !stop.signal.aborted && ((first = c), halt()))
    dst.stdin!.on('error', () => {}) // the destination died: its own result says why
    src.stdout!.on('data', (b: Buffer) => p.add(b.length)).pipe(dst.stdin!)
    const [s, d] = await Promise.all([collect(src, stop.signal, { out: false, kill: killer(src) }), collect(dst, stop.signal, { kill: killer(dst) })])
    signal.removeEventListener('abort', halt)
    src.stdout!.destroy()
    if (signal.aborted) {
      await clean()
      signal.throwIfAborted()
    }
    if (s.code || d.code) {
      await clean()
      p.fail(i.src, first === dst ? why(d, s) : why(s, d))
      continue
    }
    try {
      if (spec.to) {
        // ponytail: check-then-mv, as remoteOpScript
        const D = q(i.dest)
        const r = await run(spec.to, `d=${q(part)}; ${i.replace ? `rm -rf -- ${D} && ` : ''}if [ -e ${D} ] || [ -L ${D} ]; then echo ${q(t(EXISTS))} >&2; false; else mv -- "$d"/${q(name)} ${D}; fi; r=$?; rm -rf -- "$d"; exit $r`)
        if (r.code) throw new Error(why(r))
      } else {
        if (i.replace && (await exists(i.dest))) {
          const [x] = await sides.trash([i.dest])
          if (x?.error) throw new Error(x.error)
        }
        await place(posix.join(part, name), i.dest)
      }
    } catch (e) {
      p.fail(i.src, (e as Error).message)
      continue
    } finally {
      if (!spec.to) await clean()
    }
    if (spec.op === 'move') {
      const error = spec.from ? await run(spec.from, `rm -rf -- ${q(i.src)}`).then(r => (r.code ? why(r) : '')) : (await sides.trash([i.src]))[0]?.error
      if (error) p.fail(i.src, t("Copiato, ma l'originale non è stato rimosso: {error}", { error }))
    }
  }
}
