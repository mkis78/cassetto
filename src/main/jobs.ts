import { randomUUID } from 'node:crypto'
import { isEnded as ended, routeOf, type JobSnapshot, type JobSpec } from '../shared/jobs'

export type Progress = { total(n: number | null): void; add(bytes: number): void; item(name: string | null): void; fail(path: string, error: string): void }
export type Worker = (spec: JobSpec, p: Progress, signal: AbortSignal) => Promise<void>

type Job = JobSnapshot & { ctrl: AbortController }

// jobs on the same route (from>to) run one after another, in start order; other routes run concurrently
export class JobQueue {
  private jobs: Job[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private last = 0
  private worker: Worker
  private out: (jobs: JobSnapshot[]) => void
  private throttle: number
  constructor(o: { worker: Worker; emit: (jobs: JobSnapshot[]) => void; throttleMs?: number }) {
    this.worker = o.worker
    this.out = o.emit
    this.throttle = o.throttleMs ?? 250
  }

  start(spec: JobSpec): string {
    const id = randomUUID()
    this.jobs.push({ id, spec, state: 'queued', bytes: 0, total: null, current: null, failed: [], started: null, ended: null, ctrl: new AbortController() })
    this.flush()
    this.pump()
    return id
  }

  cancel(id: string): void {
    const j = this.jobs.find(j => j.id === id)
    if (!j || ended(j)) return
    if (j.state === 'queued') (j.state = 'cancelled'), (j.ended = Date.now()), this.flush()
    else j.ctrl.abort() // the state turns cancelled when the worker settles
  }

  clear(): void {
    this.jobs = this.jobs.filter(j => !ended(j))
    this.flush()
  }

  list(): JobSnapshot[] {
    return this.jobs.map(({ ctrl: _c, ...j }) => ({ ...j, failed: [...j.failed] }))
  }

  running(): boolean {
    return this.jobs.some(j => !ended(j))
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer), (this.timer = null)
    this.last = Date.now()
    try {
      this.out(this.list())
    } catch {} // a dead window must not stall the queue
  }

  private progress(): void {
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), Math.max(0, this.last + this.throttle - Date.now()))
  }

  private pump(): void {
    const busy = new Set(this.jobs.filter(j => j.state === 'measuring' || j.state === 'running').map(j => routeOf(j.spec)))
    for (const j of this.jobs) {
      const r = routeOf(j.spec)
      if (j.state === 'queued' && !busy.has(r)) busy.add(r), void this.run(j)
    }
  }

  private async run(j: Job): Promise<void> {
    j.state = 'measuring'
    j.started = Date.now()
    this.flush()
    const p: Progress = {
      total: n => {
        if (ended(j)) return
        j.total = n
        if (j.state === 'measuring') (j.state = 'running'), this.flush()
        else this.progress()
      },
      add: b => !ended(j) && ((j.bytes += b), this.progress()),
      item: name => !ended(j) && ((j.current = name), this.progress()),
      fail: (path, error) => !ended(j) && (j.failed.push({ path, error }), this.progress())
    }
    try {
      await this.worker(j.spec, p, j.ctrl.signal)
    } catch (e) {
      if (!j.ctrl.signal.aborted) j.failed.push({ path: j.spec.items[0]?.src ?? '', error: e instanceof Error ? e.message : String(e) })
    }
    j.state = j.ctrl.signal.aborted ? 'cancelled' : j.failed.length ? 'failed' : 'done'
    j.current = null
    j.ended = Date.now()
    this.flush()
    this.pump()
  }
}
