import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { JobQueue, type Worker } from '../src/main/jobs'
import type { JobSnapshot, JobSpec } from '../src/shared/jobs'

const spec = (to: string | null = null): JobSpec => ({ op: 'copy', from: null, to, items: [{ src: '/a', dest: '/b', replace: false }] })
const defer = () => {
  let resolve!: () => void
  const promise = new Promise<void>(r => (resolve = r))
  return { promise, resolve }
}
const tick = () => new Promise(r => setImmediate(r))

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }))
afterEach(() => vi.useRealTimers())

const make = (worker: Worker) => {
  const emits: JobSnapshot[][] = []
  const q = new JobQueue({ worker, emit: j => emits.push(j) })
  return { q, emits }
}
const state = (q: JobQueue, id: string) => q.list().find(j => j.id === id)!.state

describe('JobQueue', () => {
  test('routes: same route serial, different routes concurrent', async () => {
    const gates = [defer(), defer(), defer()]
    let n = 0
    const started: number[] = []
    const { q } = make(() => {
      const i = n++
      started.push(i)
      return gates[i].promise
    })
    const a = q.start(spec())
    const b = q.start(spec())
    const c = q.start(spec('h1'))
    await tick()
    expect(started).toEqual([0, 1])
    expect(state(q, b)).toBe('queued')
    expect(state(q, c)).toBe('measuring')
    gates[0].resolve()
    await tick()
    expect(state(q, a)).toBe('done')
    expect(state(q, b)).toBe('measuring')
  })

  test('states', async () => {
    const g = defer()
    const g2 = defer()
    const { q, emits } = make(async (_s, p) => {
      await g.promise
      p.total(100)
      p.add(40)
      await g2.promise
      p.add(60)
    })
    const id = q.start(spec())
    await tick()
    expect(state(q, id)).toBe('measuring')
    g.resolve()
    await tick()
    expect(q.list()[0]).toMatchObject({ state: 'running', total: 100, bytes: 40 })
    g2.resolve()
    await tick()
    expect(q.list()[0]).toMatchObject({ state: 'done', bytes: 100 })
    expect(emits.at(-1)![0].state).toBe('done')
    expect(q.running()).toBe(false)
  })

  test('fail and throw end failed', async () => {
    const { q } = make(async (s, p) => {
      if (s.to) throw new Error('boom')
      p.fail('a', 'x')
    })
    const a = q.start(spec())
    const b = q.start(spec('h'))
    await tick()
    expect(q.list().find(j => j.id === a)).toMatchObject({ state: 'failed', failed: [{ path: 'a', error: 'x' }] })
    expect(q.list().find(j => j.id === b)).toMatchObject({ state: 'failed', failed: [{ path: '/a', error: 'boom' }] })
  })

  test('cancel', async () => {
    const g = defer()
    let signal!: AbortSignal
    const worker = vi.fn<Worker>((_s, _p, sig) => ((signal = sig), g.promise))
    const { q } = make(worker)
    const a = q.start(spec())
    const b = q.start(spec())
    await tick()
    q.cancel(b)
    expect(state(q, b)).toBe('cancelled')
    q.cancel(a)
    expect(signal.aborted).toBe(true)
    g.resolve()
    await tick()
    expect(state(q, a)).toBe('cancelled')
    expect(worker).toHaveBeenCalledTimes(1)
    const c = q.start(spec('h'))
    q.clear()
    expect(q.list().map(j => j.id)).toEqual([c])
  })

  test('throttle: progress coalesced, state change immediate', async () => {
    const g = defer()
    let p!: Parameters<Worker>[1]
    const { q, emits } = make((_s, pr) => ((p = pr), g.promise))
    q.start(spec())
    await tick()
    p.total(1000)
    const n = emits.length
    for (let i = 0; i < 20; i++) p.add(1)
    expect(emits.length).toBeLessThanOrEqual(n + 1)
    await vi.advanceTimersByTimeAsync(300)
    expect(emits.length).toBeLessThanOrEqual(n + 2)
    expect(emits.at(-1)![0].bytes).toBe(20)
    const m = emits.length
    g.resolve()
    await tick()
    expect(emits.length).toBeGreaterThan(m)
  })
})
