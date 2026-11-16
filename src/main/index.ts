import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell as electronShell, type MenuItemConstructorOptions } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AppState, FileOp, SearchQuery } from '../shared/types'
import { runOpLocal, runOpRemote } from './fileOps'
import { listRemote, listSshHosts, previewRemote, shQuote, sshRun } from './ssh'
import { listLocal, previewLocal } from './files'
import { listFiles, runSearch, runSearchRemote } from './search'
import { imageType } from '../shared/format'
import { shortcut, type MenuItem } from '../shared/menus'
import { loadState, saveState } from './store'

if (process.env.CASSETTO_USERDATA) app.setPath('userData', process.env.CASSETTO_USERDATA)
const stateFile = () => join(app.getPath('userData'), 'state.json')
let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#14161b',
    ...(process.platform === 'darwin' && { titleBarStyle: 'hiddenInset' as const }),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
  // the window only ever shows the app: a dropped file or a link must not replace it (the preload API would stay exposed)
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('closed', () => (win = null))
}

// IPC is only accepted from our own window
const ours = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => !!win && e.sender === win.webContents
const handle = (ch: string, f: (...a: any[]) => unknown) =>
  ipcMain.handle(ch, (e, ...a) => {
    if (!ours(e)) throw new Error('forbidden')
    return f(...a)
  })
const on = (ch: string, f: (...a: any[]) => void) => ipcMain.on(ch, (e, ...a) => ours(e) && f(...a))

handle('pickFolder', async (defaultPath?: string) => {
  const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], ...(typeof defaultPath === 'string' && { defaultPath }) })
  return r.canceled ? null : r.filePaths[0]
})
handle('state:load', () => loadState(stateFile()))
handle('ssh:hosts', () => listSshHosts())
// native context menu built from data; resolves with the chosen id, or null when dismissed
handle(
  'menu:popup',
  (items: MenuItem[]) =>
    new Promise<string | null>(resolve => {
      let done = false
      const pick = (id: string | null) => !done && ((done = true), resolve(id))
      const build = (list: MenuItem[]): MenuItemConstructorOptions[] =>
        list.map(i =>
          i.separator
            ? { type: 'separator' }
            : { label: i.label, enabled: i.enabled ?? true, accelerator: i.accelerator, registerAccelerator: false, submenu: i.submenu && build(i.submenu), click: i.id ? () => pick(i.id!) : undefined }
        )
      Menu.buildFromTemplate(build(items)).popup({ window: win!, callback: () => setTimeout(() => pick(null), 50) })
    })
)
handle('clipboard:write', (t: string) => clipboard.writeText(t))
handle('files:list', (host: string | null, path: string | null) => (host ? listRemote(host, path) : listLocal(path ?? homedir())))
handle('files:all', (cwd: string) => listFiles(cwd))
handle('files:preview', (host: string | null, path: string) => (host ? previewRemote(host, path) : previewLocal(path)))
handle('files:op', (host: string | null, op: FileOp) => (host ? runOpRemote(host, op) : runOpLocal(op, p => electronShell.trashItem(p))))
handle('openPath', (p: string) => electronShell.openPath(p))

// An image's bytes for a thumbnail; the renderer scales it down (Chromium decodes off the main thread,
// the same formats everywhere). Big files are skipped: a thumbnail is not worth reading them, least of all over ssh.
const THUMB_LIMIT = { local: 20 * 1024 * 1024, remote: 5 * 1024 * 1024 }
handle('files:image', async (host: string | null, path: string): Promise<Uint8Array | null> => {
  if (!imageType(path)) return null
  try {
    if (!host) return (await stat(path)).size > THUMB_LIMIT.local ? null : await readFile(path)
    const r = await sshRun(host, `head -c ${THUMB_LIMIT.remote + 1} -- ${shQuote(path)}`, { maxBuffer: THUMB_LIMIT.remote + 1024 })
    return r.ok && r.out.length <= THUMB_LIMIT.remote ? r.out : null
  } catch {
    return null
  }
})
// one search per tab: a new query cancels the one still running
const searches = new Map<string, AbortController>()
handle('search:run', async (tileId: string, host: string | null, cwd: string, q: SearchQuery) => {
  searches.get(tileId)?.abort()
  const ac = new AbortController()
  searches.set(tileId, ac)
  try {
    return await (host ? runSearchRemote(host, cwd, q, 1000, ac.signal) : runSearch(cwd, q, 1000, ac.signal))
  } finally {
    if (searches.get(tileId) === ac) searches.delete(tileId)
  }
})
on('state:save', (s: AppState) => {
  try {
    saveState(stateFile(), s)
  } catch (err) {
    console.error('salvataggio stato fallito', err)
  }
})
ipcMain.on('homeDir', e => (e.returnValue = homedir()))

function setMenu(): void {
  const p = process.platform
  const send = (ch: string, ...a: unknown[]) => () => win?.webContents.send(ch, ...a)
  const settings: MenuItemConstructorOptions = { label: 'Impostazioni…', accelerator: p === 'darwin' ? 'Cmd+,' : 'Ctrl+,', click: send('settings:open') }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      p === 'darwin'
        ? { role: 'appMenu', submenu: [{ role: 'about' }, settings, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }
        : { label: 'Cassetto', submenu: [settings, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      {
        label: 'Archivio',
        submenu: [
          { label: 'Nuovo tab', accelerator: shortcut('T', p), click: send('tile:new') },
          { label: 'Connetti a server SSH…', accelerator: p === 'darwin' ? 'Cmd+K' : 'Ctrl+Shift+K', click: send('ssh:open') },
          { label: 'Vai a file…', accelerator: shortcut('P', p), registerAccelerator: false, click: send('palette:open', false) },
          ...(p === 'darwin' ? [{ label: 'Comandi…', accelerator: 'Cmd+Shift+P', registerAccelerator: false, click: send('palette:open', true) }] : []),
          { type: 'separator' },
          // shown here, handled by the renderer
          { label: 'Tab successivo', accelerator: shortcut(']', p), registerAccelerator: false, click: send('tile:cycle', 1) },
          { label: 'Tab precedente', accelerator: shortcut('[', p), registerAccelerator: false, click: send('tile:cycle', -1) },
          { label: 'Chiudi tab', accelerator: shortcut('W', p), click: send('tile:close') }
        ]
      },
      { label: 'Vista', submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
      p === 'darwin' ? { role: 'windowMenu' } : { label: 'Finestra', submenu: [{ role: 'minimize', registerAccelerator: false }] }
    ])
  )
}

app.whenReady().then(() => {
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png')) // the packaged app gets it from the bundle
  setMenu()
  createWindow()
})
app.on('window-all-closed', () => app.quit())
