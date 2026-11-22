import type { Commit } from './types'

export type RefNode<T> = { kind: 'leaf'; label: string; item: T } | { kind: 'folder'; label: string; path: string; children: RefNode<T>[] }

// branches grouped by their slash prefixes (feat/x, feat/y → feat/), folders first, each alphabetical
export function refTree<T extends { name: string }>(items: T[], strip = ''): RefNode<T>[] {
  const build = (list: { rest: string[]; item: T }[], prefix: string): RefNode<T>[] => {
    const folders = new Map<string, { rest: string[]; item: T }[]>()
    const leaves: RefNode<T>[] = []
    for (const e of list) {
      if (e.rest.length === 1) leaves.push({ kind: 'leaf', label: e.rest[0], item: e.item })
      else {
        const [head, ...rest] = e.rest
        if (!folders.has(head)) folders.set(head, [])
        folders.get(head)!.push({ rest, item: e.item })
      }
    }
    const by = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label)
    const dirs = [...folders].map(([label, l]): RefNode<T> => ({ kind: 'folder', label, path: prefix + label, children: build(l, prefix + label + '/') }))
    return [...dirs.sort(by), ...leaves.sort(by)]
  }
  return build(items.map(item => ({ rest: item.name.slice(item.name.startsWith(strip) ? strip.length : 0).split('/'), item })), '')
}

// leaves whose full name contains q (any case); folders left without matches go
export function filterTree<T>(nodes: RefNode<T>[], q: string, name: (t: T) => string): RefNode<T>[] {
  const s = q.trim().toLowerCase()
  if (!s) return nodes
  return nodes.flatMap((n): RefNode<T>[] => {
    if (n.kind === 'leaf') return name(n.item).toLowerCase().includes(s) ? [n] : []
    const children = filterTree(n.children, s, name)
    return children.length ? [{ ...n, children }] : []
  })
}

// commit search in the graph: words in the subject or author, or the start of the sha
export function matchCommit(c: Commit, q: string): boolean {
  const s = q.trim().toLowerCase()
  return !!s && (c.subject.toLowerCase().includes(s) || c.author.toLowerCase().includes(s) || c.sha.startsWith(s))
}

// the next match after `from` going `dir`, wrapping around; -1 when none
export function nextMatch(commits: Commit[], q: string, from: number, dir: 1 | -1): number {
  const n = commits.length
  for (let k = 1; k <= n; k++) {
    const i = (((from + k * dir) % n) + n) % n
    if (matchCommit(commits[i], q)) return i
  }
  return -1
}
