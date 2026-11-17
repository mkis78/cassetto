import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, protocol, session, shell as electronShell, type MenuItemConstructorOptions } from 'electron'
import { pathToFileURL } from 'node:url'
import { APP_ORIGIN, appFile } from './appProtocol'
import { execFile } from 'node:child_process'
import { readFile, stat, statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { AppState, FileOp, SearchHit, SearchQuery } from '../shared/types'
import { runOpLocal, runOpRemote } from './fileOps'
import { listRemote, listSshHosts, previewRemote, readRemote, shQuote, sshOptions, sshRun, writeRemote } from './ssh'
import { spawn as spawnPty } from 'node-pty'
import { existsSync } from 'node:fs'
import { PtyManager, terminalLaunch } from './terminal'
import { editTags, folderTags, runTagSearch } from './tags'
import type { Tag } from '../shared/tags'
import { listLocal, previewLocal, readLocal, writeLocal } from './files'
import { listFiles, runSearch, runSearchRemote } from './search'
import { imageType } from '../shared/format'
import { shortcut, type MenuItem } from '../shared/menus'
import { loadState, saveState } from './store'
import { parseDf, parseDu, type Disk } from '../shared/status'
import { DEFAULT_BAR, systemConflict, type SymbolicHotkeys } from '../shared/shortcuts'

if (process.env.CASSETTO_USERDATA) app.setPath('userData', process.env.CASSETTO_USERDATA)
const stateFile = () => join(app.getPath('userData'), 'state.json')
let win: BrowserWindow | null = null
// standard and secure: what module scripts, fetch and the editor's lazy chunk need, as on https
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])
const ptys = new PtyManager(spawnPty)
const shell = process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
let barShortcut = DEFAULT_BAR // shown in the menu; the renderer listens for the key itself

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#14161b',
    ...(process.platform === 'darwin' && { titleBarStyle: 'hiddenInset' as const }),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadURL(`${APP_ORIGIN}/index.html`)
  // the window only ever shows the app: a dropped file or a link must not replace it (the preload API would stay exposed)
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('closed', () => (ptys.killAll(), (win = null)))
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
// a filled circle for a menu item, 12pt at 2x, edges antialiased by distance from the centre
function dotIcon(hex: string, hollow = false): Electron.NativeImage | undefined {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) return undefined
  const [r, g, b] = m.slice(1).map(h => parseInt(h, 16))
  const n = 24, buf = Buffer.alloc(n * n * 4)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2)
      const a = Math.max(0, Math.min(1, 9.5 - d)) * (hollow ? Math.max(0, Math.min(1, d - 7.5)) : 1) // radius 9px of 12, a 2px ring when hollow
      buf.set([Math.round(b * a), Math.round(g * a), Math.round(r * a), Math.round(255 * a)], (y * n + x) * 4) // BGRA, premultiplied
    }
  return nativeImage.createFromBitmap(buf, { width: n, height: n, scaleFactor: 2 })
}

// a menu icon drawn by the renderer: a PNG at 2x, nothing else; a template, so macOS colours it
function menuImage(dataUrl: string): Electron.NativeImage | undefined {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return undefined
  const img = nativeImage.createFromBuffer(Buffer.from(m[1], 'base64'), { scaleFactor: 2 })
  if (img.isEmpty()) return undefined
  img.setTemplateImage(true)
  return img
}

// native context menu built from data; resolves with the chosen id, or null when dismissed
handle(
  'menu:popup',
  (items: MenuItem[], at?: { x: number; y: number }) =>
    new Promise<string | null>(resolve => {
      let done = false
      const pick = (id: string | null) => !done && ((done = true), resolve(id))
      const build = (list: MenuItem[]): MenuItemConstructorOptions[] =>
        list.map(i =>
          i.separator
            ? { type: 'separator' }
            : { label: i.label, enabled: i.enabled ?? true, accelerator: i.accelerator, registerAccelerator: false, submenu: i.submenu && build(i.submenu), icon: i.dot ? dotIcon(i.dot, i.hollow) : i.image ? menuImage(i.image) : undefined, ...(i.checked !== undefined && { type: 'checkbox' as const, checked: i.checked }), click: i.id ? () => pick(i.id!) : undefined }
        )
      Menu.buildFromTemplate(build(items)).popup({ window: win!, ...(at && { x: at.x, y: at.y }), callback: () => setTimeout(() => pick(null), 50) })
    })
)
handle('clipboard:write', (t: string) => clipboard.writeText(t))
handle('clipboard:read', () => clipboard.readText())

// terminal tabs: one pty each, its output and exit sent to the window
handle('pty:create', (id: string, p: { host: string | null; cwd: string }, cols: number, rows: number) => {
  if (!p.host && !existsSync(p.cwd)) throw new Error(`Cartella non trovata: ${p.cwd}`) // node-pty would report only "exit 1"
  ptys.create(
    id,
    terminalLaunch(p, { shell, home: homedir(), sshOptions }),
    cols,
    rows,
    d => win?.webContents.send('pty:data', id, d),
    code => win?.webContents.send('pty:exit', id, code)
  )
})
on('pty:write', (id: string, d: string) => ptys.write(id, d))
on('pty:resize', (id: string, c: number, r: number) => ptys.resize(id, c, r))
on('pty:kill', (id: string) => ptys.kill(id))
// a local listing carries the Finder tags of what it holds
handle('files:list', async (host: string | null, path: string | null) => {
  if (host) return listRemote(host, path)
  const r = await listLocal(path ?? homedir())
  if (!r.ok) return r
  const tags = await folderTags(r.listing.path)
  if (tags.size) r.listing.entries = r.listing.entries.map(e => (tags.has(e.name) ? { ...e, tags: tags.get(e.name) } : e))
  return r
})
handle('tags:edit', (paths: string[], change: { add?: Tag[]; remove?: string[] }) => editTags(paths, change))
handle('files:all', (cwd: string) => listFiles(cwd))
handle('files:preview', (host: string | null, path: string) => (host ? previewRemote(host, path) : previewLocal(path)))
handle('files:read', (host: string | null, path: string) => (host ? readRemote(host, path) : readLocal(path)))
handle('files:write', (host: string | null, path: string, text: string) => (typeof text !== 'string' ? { ok: false, error: 'testo non valido' } : host ? writeRemote(host, path, text) : writeLocal(path, text)))
handle('files:op', (host: string | null, op: FileOp) => (host ? runOpRemote(host, op) : runOpLocal(op, p => electronShell.trashItem(p))))
handle('openPath', (p: string) => electronShell.openPath(p))
handle('app:quit', () => app.quit())

// free and total space of the disk holding `path`; null when it cannot be read
handle('files:disk', async (host: string | null, path: string): Promise<Disk | null> => {
  try {
    if (host) {
      const r = await sshRun(host, `df -Pk -- ${shQuote(path)}`, { timeout: 15_000 })
      return r.ok ? parseDf(r.out.toString()) : null
    }
    const s = await statfs(path) // ponytail: "available" without the purgeable space macOS can free on demand; Finder counts that too
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize }
  } catch {
    return null
  }
})
// what a folder weighs with everything inside; can take a while, so only on request
handle('files:du', async (host: string | null, path: string): Promise<number | null> => {
  if (host) {
    const r = await sshRun(host, `du -sk -- ${shQuote(path)} 2>/dev/null; true`, { timeout: 300_000 })
    return r.ok ? parseDu(r.out.toString()) : null
  }
  // du exits 1 when some folder inside cannot be read, and still prints the total of the rest
  return new Promise(ok => execFile('du', ['-sk', '--', path], { timeout: 300_000 }, (_e, out) => ok(parseDu(out ?? ''))))
})

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
// hits stream to the renderer as they are found, a batch at most every 80 ms; the reply is the whole result
const searches = new Map<string, AbortController>()
handle('search:run', async (tileId: string, run: number, host: string | null, cwd: string, q: SearchQuery) => {
  searches.get(tileId)?.abort()
  const ac = new AbortController()
  searches.set(tileId, ac)
  let batch: SearchHit[] = []
  let timer: NodeJS.Timeout | null = null
  const flush = () => {
    timer = null
    if (batch.length && !ac.signal.aborted) win?.webContents.send('search:hits', tileId, run, batch)
    batch = []
  }
  const onHits = (h: SearchHit[]) => {
    batch.push(...h)
    timer ??= setTimeout(flush, 80)
  }
  try {
    if (q.mode === 'tag') return host ? { hits: [], truncated: false, error: 'I tag esistono solo per i file del Mac' } : await runTagSearch(cwd, q, ac.signal, onHits)
    return await (host ? runSearchRemote(host, cwd, q, ac.signal, onHits) : runSearch(cwd, q, ac.signal, onHits))
  } finally {
    if (timer) clearTimeout(timer) // what is left comes with the reply
    if (searches.get(tileId) === ac) searches.delete(tileId)
  }
})
// a command's output, or '' when it fails (not installed, no such preference)
const run = (file: string, args: string[]) => new Promise<string>(ok => execFile(file, args, { timeout: 3000 }, (err, out) => ok(err ? '' : out)))

// macOS: the system shortcut (or Raycast's) that would take this one before the window sees it
handle('shortcut:conflict', async (shortcut: string) => {
  if (process.platform !== 'darwin' || typeof shortcut !== 'string') return null
  let hotkeys: SymbolicHotkeys = {}
  try {
    hotkeys = JSON.parse(await run('plutil', ['-convert', 'json', '-o', '-', join(homedir(), 'Library/Preferences/com.apple.symbolichotkeys.plist')])).AppleSymbolicHotKeys ?? {}
  } catch {
    // no preferences file: the defaults of a fresh Mac
  }
  return systemConflict(shortcut, hotkeys, (await run('defaults', ['read', 'com.raycast.macos', 'raycastGlobalHotkey'])).trim())
})

on('state:save', (s: AppState) => {
  const bar = s?.settings?.barShortcut ?? DEFAULT_BAR
  if (bar !== barShortcut) ((barShortcut = bar), setMenu())
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
          { label: 'Nuovo terminale qui', accelerator: 'CmdOrCtrl+Alt+T', click: send('terminal:new') },
          // shown here, handled by the renderer: inside the editor Cmd+K starts chords (Cmd+K Cmd+U)
          { label: 'Connetti a server SSH…', accelerator: shortcut('K', p), registerAccelerator: false, click: send('ssh:open') },
          { label: 'Barra azioni…', accelerator: barShortcut, registerAccelerator: false, click: send('palette:open', 'bar') },
          { label: 'Vai a file…', accelerator: shortcut('P', p), registerAccelerator: false, click: send('palette:open', 'files') },
          ...(p === 'darwin' ? [{ label: 'Comandi…', accelerator: 'Cmd+Shift+P', registerAccelerator: false, click: send('palette:open', 'commands') }] : []),
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
  const root = join(__dirname, '../renderer')
  protocol.handle('app', req => {
    const file = appFile(root, req.url)
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Non trovato', { status: 404 })
  })
  // the page never needs camera, microphone, location, notifications…: Electron would grant them all by default
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'fullscreen'))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen')
  barShortcut = loadState(stateFile()).settings?.barShortcut ?? DEFAULT_BAR
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png')) // the packaged app gets it from the bundle
  setMenu()
  createWindow()
})
app.on('before-quit', () => ptys.killAll())
app.on('window-all-closed', () => app.quit())
