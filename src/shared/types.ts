import type { Tag } from './tags'
import type { LangSetting } from './i18n'
import type { TabColor } from './menus'
import type { ArchiveLevel } from './archives'

// name, color: what the user gave the tab; without a name it shows the folder's; archives: the ones it is inside, outermost first
export type FilesParams = { kind: 'files'; host: string | null; path: string | null; hidden?: boolean; preview?: boolean; query?: SearchQuery | null; name?: string; color?: TabColor; archives?: ArchiveLevel[] }
// a shell in `cwd`, here or on `host` over ssh
export type TerminalParams = { kind: 'terminal'; host: string | null; cwd: string; name?: string; color?: TabColor }
// a text file being edited, here or on `host`; readOnly: a file inside an archive, never saved
export type EditorParams = { kind: 'editor'; host: string | null; path: string; name?: string; color?: TabColor; wrap?: boolean; whitespace?: boolean; mdPreview?: boolean; readOnly?: boolean }
export type TileParams = FilesParams | TerminalParams | EditorParams

export interface SearchQuery {
  text: string
  mode: 'content' | 'name' | 'tag'
  regex: boolean
  word: boolean
  subfolders?: boolean // look below the folder too; unset counts as yes
  case?: 'smart' | 'match' | 'ignore' // unset: smart (see shared/query)
  include?: string // only these files: names or paths, comma separated ("*.ts, docs/*.md")
  exclude?: string // never these files or folders, same form ("node_modules, *.log")
  max?: number // hits at most; unset: DEFAULT_MAX
}

export interface SearchHit {
  path: string // relative to the searched folder
  tags?: Tag[] // tag search: the tags the file carries
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
  layouts?: SavedLayout[] // saved by name, to reopen later
  settings?: Settings
  sidebar?: SidebarState
}

// a folder kept in the sidebar, here or on an ssh host
export type Favourite = { host: string | null; path: string; name?: string; color?: TabColor }
// closed: the sections folded shut ('fav' | 'places' | 'disks' | 'servers')
export interface SidebarState {
  collapsed?: boolean
  width?: number
  closed?: string[]
  favourites?: Favourite[]
  recentHosts?: string[] // ssh hosts opened lately, newest first (shared/favourites pushRecent)
}

export interface Settings {
  theme: 'dark' | 'light' | 'system'
  filesHome?: string // where a new tab and its Home button go; unset: the user's home
  language?: LangSetting // the interface's; unset: the system's (see shared/i18n)
  barShortcut?: string // the action bar's, an accelerator (shared/shortcuts); unset: DEFAULT_BAR
  ignoredConflict?: string // the shortcut whose clash with the system the user chose to keep
  favStyle?: 'list' | 'tiles' // the sidebar's Favourites and Places; unset: list
}

export interface DirEntry {
  name: string
  dir: boolean
  size?: number // bytes; local listings only
  tags?: Tag[] // Finder tags; local listings on macOS only
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
  | { op: 'extract'; archive: string; dest: string }
export type OpResult = { failed: { path: string; error: string }[] } // empty: everything went through
export type UndoResult = { label: string; failed: { path: string; error: string }[]; dirs: string[] } | null // dirs: folders to refresh; null: nothing to undo
export type AppInfo = { id: string; name: string; icon?: string } // id: .app bundle path (macOS) or .desktop file (Linux); icon: PNG data URL
export type Trashed ={ path: string; trashed?: string; error?: string } // trashed: where it is now in the Trash

export type Preview = { kind: 'text'; text: string; truncated: boolean } | { kind: 'image'; src: string } | { kind: 'pdf'; src: string } | { kind: 'video'; src: string } | { kind: 'audio'; src: string } | { kind: 'binary' } | { kind: 'error'; error: string }

// a set of tabs and where they were, saved under a name
export interface SavedLayout {
  name: string
  layout: unknown // dockview toJSON()
}

export type Place = { id: 'home' | 'desktop' | 'documents' | 'downloads' | 'pictures' | 'music' | 'videos'; path: string }
export type Volume = { name: string; path: string }
