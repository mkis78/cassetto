import type { DirEntry } from './types'

// one collator for every comparison: localeCompare with options builds one per call, seconds on a 100k-entry folder
const collate = new Intl.Collator(undefined, { sensitivity: 'base' }).compare

export const sortEntries = (e: DirEntry[]): DirEntry[] => [...e].sort((a, b) => Number(b.dir) - Number(a.dir) || collate(a.name, b.name))

export type SortKey = 'name' | 'size' | 'mtime'

// folders first whatever the key (sorted by name when the key is size: a folder has none worth showing);
// equal values fall back to the name
export function sortBy(e: DirEntry[], key: SortKey, desc: boolean): DirEntry[] {
  const name = (a: DirEntry, b: DirEntry) => collate(a.name, b.name)
  const by = (a: DirEntry, b: DirEntry) =>
    key === 'size' ? (a.dir ? 0 : (a.size ?? -1) - (b.size ?? -1)) : key === 'mtime' ? (a.mtime ?? 0) - (b.mtime ?? 0) : name(a, b)
  return [...e].sort((a, b) => Number(b.dir) - Number(a.dir) || (desc ? -1 : 1) * by(a, b) || name(a, b))
}
