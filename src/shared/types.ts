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
// a repository's branches, commits and changes (an optional compartment, see renderer/modules);
// the rest is how the tab was left: sidebar shown, closed sections, the graph narrowed to one ref or without some (full refnames)
export type GitParams = { kind: 'git'; cwd: string; name?: string; color?: TabColor; sidebar?: boolean; collapsed?: string[]; solo?: string | null; hidden?: string[]; refsWidth?: number }
export type TileParams = FilesParams | TerminalParams | EditorParams | GitParams

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
  modules?: { git?: boolean } // optional compartments, off until switched on
}

// git (the Git tile)
export interface Ref {
  name: string
  kind: 'head' | 'branch' | 'remote' | 'tag' // head = branch currently checked out
}

export interface Commit {
  sha: string
  parents: string[]
  author: string
  time: number // unix seconds
  subject: string
  refs: Ref[]
}

// what the git graph loads: one ref alone, or all but the hidden ones (full refnames), newest `limit` commits
export type LogView = { solo: string | null; hidden: string[]; limit: number }

export interface GitStatus {
  repo: boolean
  branch: string | null // null when detached
  upstream: string | null
  remote: string | null // where pushes go: the upstream's remote, else origin, else the only remote
  ahead: number
  behind: number
  changes: number
  operation: GitOperation | null // a merge, rebase, cherry-pick or revert stopped halfway (conflicts)
  conflicts: string[]
  error?: 'not-repo' | 'no-git' // why repo is false, for the tile to say
}

export type GitOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

// a changed file: status is git's letter (M A D R C T U, ? = untracked); oldPath for renames and copies
export interface FileChange {
  path: string
  status: string
  oldPath?: string
  from?: string // the commit holding this file when it is not the one shown: a stash's untracked files
}

export interface Changes {
  staged: FileChange[]
  unstaged: FileChange[] // conflicts (U) and untracked (?) included
}

export interface CommitInfo {
  sha: string
  author: string
  email: string
  time: number
  message: string
  files: FileChange[] // against the first parent
}

export interface GitRefs {
  branches: { name: string; sha: string; upstream: string | null; track: string }[] // track: "[ahead 1, behind 2]" or ""
  remoteBranches: { name: string; sha: string }[] // "origin/main"
  tags: { name: string; sha: string }[]
  remotes: string[]
  stashes: { index: number; sha: string; message: string }[]
  worktrees: Worktree[] // other checkouts of this repository, the main one excluded
}

export interface Worktree {
  path: string
  branch: string | null // null when detached
  sha: string
}

// the two sides of a file's diff: a commit against its parent, the index against HEAD, the working file against the index
export type DiffSpec =
  | { kind: 'commit'; sha: string; path: string; oldPath?: string }
  | { kind: 'staged'; path: string; oldPath?: string }
  | { kind: 'unstaged'; path: string }
export type DiffTexts = { ok: true; original: string; modified: string } | { ok: false; error: string }

export type GitAction =
  | { op: 'fetch' }
  | { op: 'pull' }
  | { op: 'push'; setUpstream: boolean; remote: string }
  | { op: 'checkout'; branch: string }
  | { op: 'merge'; ref: string }
  | { op: 'rebase'; onto: string }
  | { op: 'abort'; what: GitOperation }
  | { op: 'continue'; what: GitOperation }
  | { op: 'pushBranch'; branch: string; remote: string }
  | { op: 'branch'; name: string; sha: string; checkout: boolean }
  | { op: 'deleteBranch'; name: string; force: boolean }
  | { op: 'deleteRemoteBranch'; remote: string; name: string }
  | { op: 'renameBranch'; from: string; to: string }
  | { op: 'cherryPick'; sha: string }
  | { op: 'revert'; sha: string }
  | { op: 'reset'; sha: string; mode: 'soft' | 'mixed' | 'hard' }
  | { op: 'stage'; paths: string[] }
  | { op: 'unstage'; paths: string[] }
  | { op: 'discard'; paths: string[]; untracked: boolean }
  | { op: 'commit'; message: string; amend: boolean }
  | { op: 'stash'; message: string | null }
  | { op: 'stashPop' | 'stashApply' | 'stashDrop'; index: number }
  | { op: 'worktreeRemove'; path: string; force: boolean }
  | { op: 'tag'; name: string; sha: string; message: string | null }
  | { op: 'pushTag'; name: string; remote: string }

export interface GitResult {
  ok: boolean
  output: string
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

export type ReadResult = { ok: true; text: string } | { ok: false; error: string; binary?: boolean; large?: boolean }
export type WriteResult = { ok: true } | { ok: false; error: string }

// what the Files tile asks main to do; copy/move items carry their final destination path
export type FileOp =
  | { op: 'mkdir' | 'touch'; path: string }
  | { op: 'rename'; from: string; to: string }
  | { op: 'renameMany'; items: { from: string; to: string }[] } // all in one folder
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
