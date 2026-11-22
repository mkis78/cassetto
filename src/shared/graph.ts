import type { Commit } from './types'

export interface GraphRow {
  lane: number
  edges: { from: number; to: number }[] // from this row's lane (center) to the next row's lane (center)
  width: number
}

// Lanes hold the sha each column is waiting for; a sha is never expected in two lanes.
export function layoutGraph(commits: Commit[]): GraphRow[] {
  const lanes: (string | null)[] = []
  let width = 0
  return commits.map(c => {
    let lane = lanes.indexOf(c.sha)
    if (lane < 0) lane = lanes.indexOf(null)
    if (lane < 0) lane = lanes.length
    const pending: { from: number; sha: string }[] = []
    lanes.forEach((s, k) => s && k !== lane && pending.push({ from: k, sha: s }))
    lanes[lane] = null

    c.parents.forEach((p, j) => {
      const existing = lanes.indexOf(p)
      if (j === 0 && !(existing >= 0 && existing < lane)) {
        // first parent continues this lane; a lane further right waiting for it joins here
        lanes[lane] = p
        if (existing > lane) lanes[existing] = null
      } else if (existing < 0) {
        const free = lanes.indexOf(null)
        lanes[free < 0 ? lanes.length : free] = p
      }
      pending.push({ from: lane, sha: p })
    })

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    width = Math.max(width, lanes.length, lane + 1)
    const seen = new Set<string>()
    const edges = pending
      .map(e => ({ from: e.from, to: lanes.indexOf(e.sha) }))
      .filter(e => e.to >= 0 && !seen.has(`${e.from}>${e.to}`) && seen.add(`${e.from}>${e.to}`))
    return { lane, edges, width }
  })
}

// the loaded commits a ref's history goes through: what lights up when a branch is picked;
// null when `from` is not in the graph (a stash, a hidden branch), so nothing gets dimmed
export function reachable(commits: Commit[], from: string): Set<string> | null {
  const parents = new Map(commits.map(c => [c.sha, c.parents]))
  const seen = new Set<string>()
  if (!parents.has(from)) return null
  const stack = [from]
  while (stack.length) {
    const sha = stack.pop()!
    if (seen.has(sha) || !parents.has(sha)) continue
    seen.add(sha)
    stack.push(...parents.get(sha)!)
  }
  return seen
}
