import type { DirEntry } from './types'

export const sortEntries = (e: DirEntry[]): DirEntry[] =>
  [...e].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

export type SortKey = 'name' | 'size' | 'mtime'

// folders first whatever the key (sorted by name when the key is size: a folder has none worth showing);
// equal values fall back to the name
export function sortBy(e: DirEntry[], key: SortKey, desc: boolean): DirEntry[] {
  const name = (a: DirEntry, b: DirEntry) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const by = (a: DirEntry, b: DirEntry) =>
    key === 'size' ? (a.dir ? 0 : (a.size ?? -1) - (b.size ?? -1)) : key === 'mtime' ? (a.mtime ?? 0) - (b.mtime ?? 0) : name(a, b)
  return [...e].sort((a, b) => Number(b.dir) - Number(a.dir) || (desc ? -1 : 1) * by(a, b) || name(a, b))
}
