import { contextBridge, ipcRenderer } from 'electron'
import type { AppState, FileOp, ListResult, OpResult, Preview, SearchQuery, SearchResult } from '../shared/types'
import type { MenuItem } from '../shared/menus'

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
  popupMenu: (items: MenuItem[]): Promise<string | null> => ipcRenderer.invoke('menu:popup', items),
  clipboardWrite: (t: string): Promise<void> => ipcRenderer.invoke('clipboard:write', t),
  sshHosts: (): Promise<string[]> => ipcRenderer.invoke('ssh:hosts'),
  search: (tileId: string, host: string | null, cwd: string, q: SearchQuery): Promise<SearchResult> => ipcRenderer.invoke('search:run', tileId, host, cwd, q),
  listDir: (host: string | null, path: string | null): Promise<ListResult> => ipcRenderer.invoke('files:list', host, path),
  listFiles: (cwd: string): Promise<{ root: string; files: string[]; truncated: boolean }> => ipcRenderer.invoke('files:all', cwd),
  preview: (host: string | null, path: string): Promise<Preview> => ipcRenderer.invoke('files:preview', host, path),
  imageBytes: (host: string | null, path: string): Promise<Uint8Array<ArrayBuffer> | null> => ipcRenderer.invoke('files:image', host, path),
  fileOp: (host: string | null, op: FileOp): Promise<OpResult> => ipcRenderer.invoke('files:op', host, op),
  openPath: (p: string): Promise<string> => ipcRenderer.invoke('openPath', p),
  homeDir: (): string => ipcRenderer.sendSync('homeDir'),
  onOpenSettings: listen<[]>('settings:open'),
  onOpenSsh: listen<[]>('ssh:open'),
  onNewTile: listen<[]>('tile:new'),
  onCloseTile: listen<[]>('tile:close'),
  onCycleTile: listen<[number]>('tile:cycle'),
  onOpenPalette: listen<[boolean]>('palette:open')
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
