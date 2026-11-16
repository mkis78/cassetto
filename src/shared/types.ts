import type { TabColor } from './menus'

// name, color: what the user gave the tab; without a name it shows the folder's
export type TileParams = { kind: 'files'; host: string | null; path: string | null; hidden?: boolean; preview?: boolean; query?: SearchQuery | null; name?: string; color?: TabColor }

export interface SearchQuery {
  text: string
  mode: 'content' | 'name'
  regex: boolean
  word: boolean
}

export interface SearchHit {
  path: string // relative to the searched folder
  line?: number // content search only
  text?: string
}

export interface SearchResult {
  hits: SearchHit[]
  truncated: boolean // more than the limit: the user should narrow the search
  error: string | null
}

export interface AppState {
  layout: unknown | null // dockview toJSON()
  settings?: Settings
}

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  filesHome?: string // where a new tab and its Home button go; unset: the user's home
}

export interface DirEntry {
  name: string
  dir: boolean
  size?: number // bytes; local listings only
  mtime?: number // ms since epoch; local listings only
}

export interface Listing {
  path: string
  entries: DirEntry[] // folders first, then files, each alphabetical
}

export type ListResult = { ok: true; listing: Listing } | { ok: false; error: string }

export type ReadResult = { ok: true; text: string } | { ok: false; error: string; binary?: boolean }
export type WriteResult = { ok: true } | { ok: false; error: string }

// what the Files tile asks main to do; copy/move items carry their final destination path
export type FileOp =
  | { op: 'mkdir' | 'touch'; path: string }
  | { op: 'rename'; from: string; to: string }
  | { op: 'copy' | 'move'; items: { src: string; dest: string; replace: boolean }[] }
  | { op: 'trash' | 'delete'; paths: string[] }
export type OpResult = { failed: { path: string; error: string }[] } // empty: everything went through

export type Preview = { kind: 'text'; text: string; truncated: boolean } | { kind: 'image'; src: string } | { kind: 'binary' } | { kind: 'error'; error: string }
