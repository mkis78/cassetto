import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, FileOp, ListResult, OpResult, Preview, SearchHit, SearchQuery, SearchResult } from '../shared/types'
import type { MenuItem } from '../shared/menus'
import type { Disk } from '../shared/status'

// a listener for a message from main; returns how to remove it
const listen =
  <A extends unknown[]>(ch: string) =>
  (cb: (...a: A) => void) => {
    const h = (_e: unknown, ...a: unknown[]) => cb(...(a as A))
    ipcRenderer.on(ch, h)
    return () => void ipcRenderer.removeListener(ch, h)
  }

const api = {
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
  fileOp: (host: string | null, op: FileOp): Promise<OpResult> => ipcRenderer.invoke('files:op', host, op),
  shortcutConflict: (shortcut: string): Promise<string | null> => ipcRenderer.invoke('shortcut:conflict', shortcut),
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('openPath', p),
  homeDir: (): string => ipcRenderer.sendSync('homeDir'),
  onOpenSettings: listen<[]>('settings:open'),
  onOpenSsh: listen<[]>('ssh:open'),
  onNewTile: listen<[]>('tile:new'),
  onCloseTile: listen<[]>('tile:close'),
  onCycleTile: listen<[number]>('tile:cycle'),
  onOpenPalette: listen<['files' | 'commands' | 'bar']>('palette:open')
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
