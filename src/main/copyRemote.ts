import { spawn, type SpawnOptions } from 'node:child_process'
import { posix } from 'node:path'
import type { JobItem, JobSpec } from '../shared/jobs'
import type { Progress } from './jobs'
import { parseOpOutput, remoteOpScript } from './fileOps'
import { remoteSh, shQuote as q, sshOptions } from './ssh'
import { t } from '../shared/i18n'

// runs a script on the host; on abort the local child is killed and what it printed so far comes back
export type Runner = (script: string, signal?: AbortSignal) => Promise<{ code: number; out: string; err: string }>

export const spawnRunner =
  (file: string, args: (script: string) => string[], o: SpawnOptions = {}): Runner =>
  (script, signal) =>
    new Promise(resolve => {
      const c = spawn(file, args(script), { ...o, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      c.stdout!.setEncoding('utf8').on('data', d => (out += d))
      c.stderr!.setEncoding('utf8').on('data', d => (err += d))
      const kill = () => c.kill()
      const end = (code: number | null) => {
        signal?.removeEventListener('abort', kill)
        resolve({ code: code ?? -1, out, err })
      }
      signal?.addEventListener('abort', kill, { once: true })
      if (signal?.aborted) kill()
      c.on('error', e => ((err += e.message), end(-1)))
      c.on('exit', code => signal?.aborted && end(code)) // a killed shell's children may still hold the pipes open
      c.on('close', end)
    })

// BatchMode: never ask for input here; the user authenticates in an SSH tile, which opens the shared connection
export const sshRunner = (host: string): Runner => spawnRunner('ssh', s => [...sshOptions(), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', host, '--', remoteSh(s)])

const kb = (s: string) => (parseInt(s, 10) || 0) * 1024

// A same-host remote copy or move, one script per item, so each item's result streams. Bytes are an estimate: `du -sk`
// of the sources up front, of the current destination every 2 s. A cancel kills the item's process group on the host,
// removes what that item had written, and throws an AbortError carrying `done` (the items finished before it).
export async function copyRemote(spec: JobSpec, p: Progress, signal: AbortSignal, run: Runner): Promise<{ done: JobItem[] }> {
  const done: JobItem[] = []
  try {
    // one line per item, empty when du fails
    const m = await run(spec.items.map(i => `echo "$(du -sk -- ${q(i.src)} 2>/dev/null | cut -f1)"`).join('\n'), signal)
    signal.throwIfAborted()
    const sizes = m.out.split('\n').map(kb)
    p.total(m.code ? null : spec.items.reduce((a, _, k) => a + (sizes[k] ?? 0), 0))
    for (const [k, i] of spec.items.entries()) {
      signal.throwIfAborted()
      p.item(posix.basename(i.src))
      const size = m.code ? 0 : (sizes[k] ?? 0)
      let counted = 0
      const count = (n: number) => {
        n = Math.min(n, size) // never backwards, never past the estimate
        if (n > counted) p.add(n - counted), (counted = n)
      }
      let live = true
      const poll = setInterval(async () => {
        if (signal.aborted) return
        const r = await run(`du -sk -- ${q(i.dest)}`, signal)
        if (live && !r.code) count(kb(r.out))
      }, 2000)
      // first line: the process group to kill on cancel, and whether the destination was already there (then it is not ours to remove).
      // ponytail: without ps the shell's own pid stands in; if that is no group leader, the copy it started may outlive the kill
      const D = q(i.dest)
      const script = `echo "$(ps -o pgid= -p $$ 2>/dev/null || echo $$) $(if [ -e ${D} ] || [ -L ${D} ]; then echo 1; else echo 0; fi)"\n${remoteOpScript({ op: spec.op, items: [i] })}`
      let r: Awaited<ReturnType<Runner>>
      try {
        r = await run(script, signal)
      } finally {
        live = false
        clearInterval(poll)
      }
      const nl = r.out.indexOf('\n')
      const [pg, existed] = (nl < 0 ? '' : r.out.slice(0, nl)).trim().split(/\s+/)
      if (signal.aborted) {
        if (/^\d+$/.test(pg)) {
          // a replace already removed the old destination; a move leaves a partial one only while its source is still there (mv across filesystems)
          const mine = i.replace || existed === '0'
          const rm = !mine ? '' : spec.op === 'move' ? `if [ -e ${q(i.src)} ] || [ -L ${q(i.src)} ]; then rm -rf -- ${D}; fi` : `rm -rf -- ${D}`
          await run(`kill -TERM -${pg} 2>/dev/null; kill -TERM ${pg} 2>/dev/null; ${rm}`)
        }
        signal.throwIfAborted()
      }
      const body = r.out.slice(nl + 1)
      if (nl >= 0 && body.includes(`O${i.src}\0`)) {
        count(size)
        done.push(i)
      } else
        p.fail(i.src, parseOpOutput(body).failed[0]?.error ?? t('{error} (esito incerto: aggiorna per vedere cosa è cambiato)', { error: r.err.trim() || `exit ${r.code}` }))
    }
  } catch (e) {
    throw Object.assign(e as object, { done })
  }
  return { done }
}
