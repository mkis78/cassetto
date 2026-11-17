import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, FileOp, ListResult, OpResult, Preview, ReadResult, SearchHit, SearchQuery, SearchResult, WriteResult } from '../shared/types'
import type { MenuItem } from '../shared/menus'
import type { Disk } from '../shared/status'
import type { Tag } from '../shared/tags'
import type { UpdateStatus } from '../main/release'

// a listener for a message from main; returns how to remove it
const listen =
  <A extends unknown[]>(ch: string) =>
  (cb: (...a: A) => void) => {
    const h = (_e: unknown, ...a: unknown[]) => cb(...(a as A))
    ipcRenderer.on(ch, h)
    return () => void ipcRenderer.removeListener(ch, h)
  }

// one IPC listener per channel, routed by terminal id (instead of one filtering listener per terminal)
function router<A extends unknown[]>(ch: string) {
  const handlers = new Map<string, (...a: A) => void>()
  ipcRenderer.on(ch, (_e, id: string, ...a: unknown[]) => handlers.get(id)?.(...(a as A)))
  return (id: string, cb: (...a: A) => void) => (handlers.set(id, cb), () => void (handlers.get(id) === cb && handlers.delete(id)))
}

const api = {
  ptyCreate: (id: string, p: { host: string | null; cwd: string }, cols: number, rows: number): Promise<void> => ipcRenderer.invoke('pty:create', id, p, cols, rows),
  ptyWrite: (id: string, d: string) => ipcRenderer.send('pty:write', id, d),
  ptyResize: (id: string, cols: number, rows: number) => ipcRenderer.send('pty:resize', id, cols, rows),
  ptyKill: (id: string) => ipcRenderer.send('pty:kill', id),
  onPtyData: router<[string]>('pty:data'),
  onPtyExit: router<[number]>('pty:exit'),
  clipboardRead: (): Promise<string> => ipcRenderer.invoke('clipboard:read'),
  platform: process.platform,
  pickFolder: (defaultPath?: string): Promise<string | null> => ipcRenderer.invoke('pickFolder', defaultPath),
  loadState: (): Promise<AppState> => ipcRenderer.invoke('state:load'),
  saveState: (s: AppState) => ipcRenderer.send('state:save', s),
  popupMenu: (items: MenuItem[], at?: { x: number; y: number }): Promise<string | null> => ipcRenderer.invoke('menu:popup', items, at),
  clipboardWrite: (t: string): Promise<void> => ipcRenderer.invoke('clipboard:write', t),
  sshHosts: (): Promise<string[]> => ipcRenderer.invoke('ssh:hosts'),
  search: (tileId: string, run: number, host: string | null, cwd: string, q: SearchQuery): Promise<SearchResult> => ipcRenderer.invoke('search:run', tileId, run, host, cwd, q),
  // the hits of search `run` of a tile, as they are found
  onSearchHits: (tileId: string, run: number, cb: (hits: SearchHit[]) => void) => listen<[string, number, SearchHit[]]>('search:hits')((t, r, hits) => t === tileId && r === run && cb(hits)),
  listDir: (host: string | null, path: string | null): Promise<ListResult> => ipcRenderer.invoke('files:list', host, path),
  listFiles: (cwd: string): Promise<{ root: string; files: string[]; truncated: boolean }> => ipcRenderer.invoke('files:all', cwd),
  preview: (host: string | null, path: string): Promise<Preview> => ipcRenderer.invoke('files:preview', host, path),
  imageBytes: (host: string | null, path: string): Promise<Uint8Array<ArrayBuffer> | null> => ipcRenderer.invoke('files:image', host, path),
  disk: (host: string | null, path: string): Promise<Disk | null> => ipcRenderer.invoke('files:disk', host, path),
  folderSize: (host: string | null, path: string): Promise<number | null> => ipcRenderer.invoke('files:du', host, path),
  readFile: (host: string | null, path: string): Promise<ReadResult> => ipcRenderer.invoke('files:read', host, path),
  writeFile: (host: string | null, path: string, text: string): Promise<WriteResult> => ipcRenderer.invoke('files:write', host, path, text),
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  relaunch: (): Promise<void> => ipcRenderer.invoke('app:relaunch'),
  checkUpdate: (): Promise<{ version: string } | null> => ipcRenderer.invoke('update:check'),
  installUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  onUpdateStatus: listen<[UpdateStatus]>('update:status'),
  onUpdateFound: listen<[string]>('update:found'),
  editTags: (paths: string[], change: { add?: Tag[]; remove?: string[] }): Promise<OpResult> => ipcRenderer.invoke('tags:edit', paths, change),
  fileOp: (host: string | null, op: FileOp): Promise<OpResult> => ipcRenderer.invoke('files:op', host, op),
  shortcutConflict: (shortcut: string): Promise<string | null> => ipcRenderer.invoke('shortcut:conflict', shortcut),
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('openPath', p),
  homeDir: (): string => ipcRenderer.sendSync('homeDir'),
  onOpenSettings: listen<[]>('settings:open'),
  onOpenSsh: listen<[]>('ssh:open'),
  onNewTile: listen<[]>('tile:new'),
  onNewTerminal: listen<[]>('terminal:new'),
  onCloseTile: listen<[]>('tile:close'),
  onCycleTile: listen<[number]>('tile:cycle'),
  onOpenPalette: listen<['files' | 'commands' | 'bar']>('palette:open')
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
