import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, net, Notification, protocol, session, shell as electronShell, type MenuItemConstructorOptions } from 'electron'
import { pathToFileURL } from 'node:url'
import { APP_ORIGIN, appFile } from './appProtocol'
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, stat, statfs } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppState, ClaudeEvent, ClaudeParams, DiffSpec, FileOp, GitAction, LogView, Place, SearchHit, SearchQuery, Trashed, UndoResult, Volume } from '../shared/types'
import { parseOpOutput, runOpLocal, runOpRemote, sshOp } from './fileOps'
import { inverseOf, runUndo, stampScript, UndoStack } from './undo'
import { trashItems } from './platform/trash'
import { appsFor, openWith } from './platform/openWith'
import { ejectVolume, listVolumes } from './platform/volumes'
import { JobQueue } from './jobs'
import { copyLocal } from './copyLocal'
import { copyRemote, sshRunner } from './copyRemote'
import { spawnSide, transfer } from './transfer'
import type { JobItem, JobSpec } from '../shared/jobs'
import { isInside } from '../shared/fileOps'
import { isValidHost, listRemote, onPath, listSshHosts, previewRemote, readRemote, shQuote, sshOptions, sshRun, writeRemote } from './ssh'
import { spawn as spawnPty } from 'node-pty'
import { existsSync, readdirSync, renameSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { PtyManager, terminalLaunch } from './terminal'
import { editTags, folderTags, runTagSearch } from './tags'
import { canSelfUpdate, checkRelease, installRelease, type Release } from './release'
import type { Tag } from '../shared/tags'
import { gitChanges, gitCommitInfo, gitDiffTexts, gitLog, gitRefs, gitRun, gitStatus, gitWorktreeAdd } from './git'
import { claudeLaunch, claudePath, forgetClaudePath, shouldFallbackToNewSession, useCswap } from './claude'
import { procCwd } from './platform/procCwd'
import { pidAlive, staleSockets, startEventServer, tryRm } from './claudeEvents'
import { listAccounts } from './cswap'
import { listLocal, previewLocal, readLocal, writeLocal } from './files'
import { MediaTokens, serveMedia } from './mediaPreview'
import { ArchiveCaches, openLocal, ownedCache, remoteCacheDir, remoteOpenScript, sweep } from './archives'
import { listFiles, runSearch, runSearchRemote } from './search'
import { imageType } from '../shared/format'
import { shortcut, type MenuItem } from '../shared/menus'
import { loadState, saveState } from './store'
import { resolveLang, setLang, t } from '../shared/i18n'
import { parseDf, parseDu, type Disk } from '../shared/status'
import { DEFAULT_BAR, systemConflict, type SymbolicHotkeys } from '../shared/shortcuts'

if (process.env.CASSETTO_USERDATA) app.setPath('userData', process.env.CASSETTO_USERDATA)
const stateFile = () => join(app.getPath('userData'), 'state.json')
// one Cassetto per userData: a second one's startup sweep would delete the first one's live caches
const single = app.requestSingleInstanceLock()
if (!single) app.quit()
let win: BrowserWindow | null = null
// standard and secure: what module scripts, fetch and the editor's lazy chunk need, as on https
// preview: PDFs, videos and audio read in pieces (Range) by <video>, <audio> and pdf.js, one token per previewed file
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'preview', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
])
const media = new MediaTokens()
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
handle('openWith:apps', (paths: string[]) => appsFor(paths))
handle('openWith:open', (appId: string, paths: string[]) => openWith(appId, paths))
handle('openWith:pick', async (paths: string[]) => {
  const mac = process.platform === 'darwin'
  const r = await dialog.showOpenDialog(win!, { defaultPath: mac ? '/Applications' : '/usr/share/applications', properties: ['openFile'], filters: [{ name: t('Applicazioni'), extensions: [mac ? 'app' : 'desktop'] }] })
  return r.canceled ? null : openWith(r.filePaths[0], paths)
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
function menuImage(dataUrl: string, template = true): Electron.NativeImage | undefined {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) return undefined
  const img = nativeImage.createFromBuffer(Buffer.from(m[1], 'base64'), { scaleFactor: 2 })
  if (img.isEmpty()) return undefined
  img.setTemplateImage(template) // app icons keep their colours
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
            : { label: i.label, enabled: i.enabled ?? true, accelerator: i.accelerator, registerAccelerator: false, submenu: i.submenu && build(i.submenu), icon: i.dot ? dotIcon(i.dot, i.hollow) : i.image ? menuImage(i.image, !i.id?.startsWith('openWith:')) : undefined, ...(i.checked !== undefined && { type: 'checkbox' as const, checked: i.checked }), click: i.id ? () => pick(i.id!) : undefined }
        )
      Menu.buildFromTemplate(build(items)).popup({ window: win!, ...(at && { x: at.x, y: at.y }), callback: () => setTimeout(() => pick(null), 50) })
    })
)
handle('clipboard:write', (text: string) => clipboard.writeText(text))
handle('clipboard:read', () => clipboard.readText())

// the hooks of the Claudes we launch report here; short path on purpose: unix socket paths are limited to 104 chars on macOS
// per-user dir where there is one (Linux /run/user/<uid>; macOS's tmpdir already is): /tmp is shared
const sockDir = process.env.XDG_RUNTIME_DIR ?? tmpdir()
const sock = join(sockDir, `cassetto-${process.pid}.sock`)
let events: Promise<() => void> | null = null // started with the first Claude, not for those who never use one
const startEvents = () =>
  (events ??= (async () => {
    for (const f of staleSockets(readdirSync(sockDir), pidAlive)) tryRm(join(sockDir, f))
    return startEventServer(sock, (id: string, e: ClaudeEvent) => win?.webContents.send('claude:event', id, e))
  })().catch(err => {
    events = null
    console.error('event server not started: no Claude status', err) // the terminal still works
    return () => {}
  }))
const toolsPath = () => claudePath(shell, homedir())
const starting = new Set<string>() // Claude tiles waiting for the account list: a kill meanwhile cancels the spawn
const notifications = new Set<Notification>()

// where a local terminal's process is now (follows the user's cd), for the paths it prints
handle('pty:cwd', (id: string) => {
  const pid = ptys.pid(id)
  return pid ? procCwd(pid) : null
})

// terminal tabs and Claude tabs: one pty each, its output and exit sent to the window
handle('pty:create', async (id: string, p: { host: string | null; cwd: string } | ClaudeParams, cols: number, rows: number) => {
  const claude = 'kind' in p && p.kind === 'claude'
  if ((claude || !(p as { host: string | null }).host) && !existsSync(p.cwd)) throw new Error(t('Cartella non trovata: {path}', { path: p.cwd })) // node-pty would report only "exit 1"
  let launch
  let tail = '' // last output, to recognise why claude exited
  if (claude) {
    starting.add(id)
    await startEvents()
    const path = await toolsPath()
    const has = onPath('cswap', path)
    const cswap = useCswap(has, has ? await listAccounts(path) : { accounts: [], error: null })
    if (!starting.delete(id)) return // killed while listing accounts
    launch = claudeLaunch(p, { sock, tileId: id, cswap, path })
  } else launch = terminalLaunch(p as { host: string | null; cwd: string }, { shell, home: homedir(), sshOptions })
  ptys.create(
    id,
    launch,
    cols,
    rows,
    d => {
      if (claude) tail = (tail + d).slice(-2000)
      win?.webContents.send('pty:data', id, d)
    },
    code => win?.webContents.send('pty:exit', id, code, claude && shouldFallbackToNewSession(p, code, tail))
  )
})
on('pty:write', (id: string, d: string) => ptys.write(id, d))
on('pty:resize', (id: string, c: number, r: number) => ptys.resize(id, c, r))
on('pty:kill', (id: string) => (starting.delete(id), ptys.kill(id)))
handle('claude:accounts', async () => listAccounts(await toolsPath()))
// fresh: the PATH is read again from the login shell (Riprova, the new-Claude dialog), for a tool installed since
handle('claude:tools', async (fresh?: boolean) => {
  if (fresh === true) forgetClaudePath()
  const path = await toolsPath()
  return { claude: onPath('claude', path), cswap: onPath('cswap', path) }
})
// a Notification is not kept alive by Electron: hold it, or macOS may collect it and the click does nothing
on('notify', (title: string, body: string, tileId: string) => {
  if (typeof title !== 'string' || typeof body !== 'string' || typeof tileId !== 'string' || !Notification.isSupported()) return
  const n = new Notification({ title, body })
  notifications.add(n)
  n.on('click', () => {
    win?.show()
    win?.focus()
    win?.webContents.send('claude:reveal', tileId)
    notifications.delete(n)
  })
  n.on('close', () => notifications.delete(n))
  n.show()
})
// a local listing carries the Finder tags of what it holds
handle('files:list', async (host: string | null, path: string | null) => {
  if (host) return listRemote(host, path)
  // side by side: on a 100k-entry folder the tags' find takes as long as the listing
  // ponytail: still a wait for both; tags sent after the entries if huge folders feel slow on macOS
  const [r, tags] = await Promise.all([listLocal(path ?? homedir()), folderTags(path ?? homedir())])
  if (!r.ok) return r
  if (tags.size) r.listing.entries = r.listing.entries.map(e => (tags.has(e.name) ? { ...e, tags: tags.get(e.name) } : e))
  return r
})
handle('tags:edit', (paths: string[], change: { add?: Tag[]; remove?: string[] }) => editTags(paths, change))
handle('files:all', (cwd: string) => listFiles(cwd))
handle('files:preview', (host: string | null, path: string) => (host ? previewRemote(host, path) : previewLocal(path, media)))
handle('files:read', (host: string | null, path: string) => (host ? readRemote(host, path) : readLocal(path)))
handle('files:write', (host: string | null, path: string, text: string) => (typeof text !== 'string' ? { ok: false, error: t('testo non valido') } : host ? writeRemote(host, path, text) : writeLocal(path, text)))
handle('git:log', (cwd: string, v: LogView) => gitLog(cwd, v))
handle('git:status', (cwd: string) => gitStatus(cwd))
handle('git:worktreeAdd', (cwd: string, branch: string) => gitWorktreeAdd(cwd, branch))
handle('git:run', (cwd: string, a: GitAction) => gitRun(cwd, a))
handle('git:changes', (cwd: string) => gitChanges(cwd))
handle('git:commit', (cwd: string, sha: string) => gitCommitInfo(cwd, sha))
handle('git:refs', (cwd: string) => gitRefs(cwd))
handle('git:diff', (cwd: string, d: DiffSpec) => gitDiffTexts(cwd, d))
// Cmd+Z: the inverse of each successful op, in memory
const undos = new UndoStack()
// no trailing newline, to compare equal with what the removal script computes; empty (missing path, or ssh failed): no stamp
const stampOf = async (host: string, path: string) => {
  const r = await sshRun(host, stampScript(path), { timeout: 60_000 })
  const s = r.ok ? r.out.toString().replace(/\n+$/, '') : ''
  return s || null
}
const remoteScript = async (host: string, script: string) => {
  const r = await sshRun(host, script, { timeout: 60_000 })
  if (!r.ok) throw new Error(r.error)
  return r.out.toString().trim()
}
handle('files:op', async (host: string | null, op: FileOp) => {
  const res = host ? await runOpRemote(host, op) : await runOpLocal(op, trashItems)
  const failed = new Set(res.failed.map(f => f.path))
  const stamps = new Map<string, string>()
  if (host && (op.op === 'mkdir' || op.op === 'touch' || op.op === 'copy' || op.op === 'extract')) {
    // mkdir needs no stamp: undo uses rmdir
    const made = op.op === 'mkdir' ? [] : 'items' in op ? op.items.filter(i => !failed.has(i.src)).map(i => i.dest) : op.op === 'extract' ? (failed.has(op.dest) ? [] : [op.dest]) : [op.path]
    for (const p of made) {
      const s = await stampOf(host, p)
      if (s !== null) stamps.set(p, s)
    }
  }
  const rec = inverseOf(host, op, failed, 'trashed' in res ? (res.trashed as Trashed[]) : [], stamps)
  if (rec) undos.push(rec)
  return { failed: res.failed }
})
// for undo: an ssh failure is thrown (not reported per item), so runUndo can tell it from a lasting refusal
const remoteUndoOp = async (host: string, op: FileOp) => {
  const r = await sshOp(host, op)
  if (!r.ok) throw new Error(r.error)
  return parseOpOutput(r.out.toString())
}
handle('files:undo', async (): Promise<UndoResult> => {
  const r = undos.pop()
  if (!r) return null
  const { retry, ...res } = await runUndo(r, { local: op => runOpLocal(op, trashItems), remote: remoteUndoOp, script: remoteScript })
  if (retry) undos.push(r) // ssh failed for every step, nothing was undone: Cmd+Z can try again
  return res
})
handle('files:undoLabel', () => undos.peek()?.label ?? null)
// updates: GitHub's latest release, offered in the top bar; only an installed app can replace itself
let release: Release | null = null
const selfUpdate = () => canSelfUpdate({ packaged: app.isPackaged, platform: process.platform, appImage: process.env.APPIMAGE })
// the copy/move queue; between machines there is no undo
const queue = new JobQueue({
  worker: async (spec, p, signal) => {
    if (spec.from !== spec.to) return transfer(spec, p, signal, { spawn: spawnSide, trash: trashItems })
    const host = spec.from
    // undo for the items that completed, after a cancel or failure too; stamps as files:op takes them for a remote copy
    const record = async ({ done, trashed = [] }: { done: JobItem[]; trashed?: Trashed[] }) => {
      const stamps = new Map<string, string>()
      if (host && spec.op === 'copy')
        for (const i of done) {
          const s = await stampOf(host, i.dest)
          if (s !== null) stamps.set(i.dest, s)
        }
      const rec = inverseOf(host, { op: spec.op, items: done }, new Set(), trashed, stamps)
      if (rec) undos.push(rec)
    }
    try {
      await record(host ? await copyRemote(spec, p, signal, sshRunner(host)) : await copyLocal(spec, p, signal, trashItems))
    } catch (e) {
      const r = e as { done?: JobItem[]; trashed?: Trashed[] } // copyLocal and copyRemote attach these to what they throw
      await record({ done: r.done ?? [], trashed: r.trashed })
      throw e
    }
  },
  emit: jobs => win?.webContents.send('jobs', jobs)
})
const validSpec = (s: any): s is JobSpec => {
  const host = (h: unknown) => h === null || (typeof h === 'string' && isValidHost(h))
  return (
    !!s && (s.op === 'copy' || s.op === 'move') && host(s.from) && host(s.to) && Array.isArray(s.items) && s.items.length > 0 &&
    s.items.every(
      (i: any) =>
        !!i && typeof i.src === 'string' && typeof i.dest === 'string' && typeof i.replace === 'boolean' &&
        // on one machine: into itself would recurse forever, replacing a folder that holds the source would delete it
        !(s.from === s.to && (isInside(i.src, i.dest) || (i.replace && isInside(i.dest, i.src))))
    )
  )
}
handle('jobs:start', (spec: unknown) => {
  if (!validSpec(spec)) throw new Error('invalid job')
  return queue.start({ op: spec.op, from: spec.from, to: spec.to, items: spec.items.map(i => ({ src: i.src, dest: i.dest, replace: i.replace })) })
})
handle('jobs:cancel', (id: string) => queue.cancel(id))
handle('jobs:clear', () => queue.clear())
handle('jobs:list', () => queue.list())

handle('update:check', async () => {
  if (!selfUpdate()) return null
  release = await checkRelease(app.getVersion())
  return release && { version: release.version }
})
handle('update:install', () => release && installRelease(release, s => win?.webContents.send('update:status', s)))
// from the menu: the same check, and an answer even when there is nothing new
async function checkNow(): Promise<void> {
  if (!selfUpdate()) return void dialog.showMessageBox(win!, { message: t("Gli aggiornamenti funzionano nell'app installata"), detail: t('Avviata con npm run dev si aggiorna con git pull.') })
  release = await checkRelease(app.getVersion())
  if (release) win?.webContents.send('update:found', release.version)
  else dialog.showMessageBox(win!, { message: t('Cassetto è aggiornato'), detail: t('Versione {version}', { version: app.getVersion() }) })
}
handle('openPath', (p: string) => electronShell.openPath(p))
handle('app:quit', () => app.quit())
// a new language takes effect on the next start: menus, dialogs and every tab are built in it from scratch
handle('app:relaunch', () => (app.relaunch(), app.quit()))

handle('sidebar:places', async (): Promise<{ places: Place[]; volumes: Volume[] }> => {
  const ids: Place['id'][] = ['home', 'desktop', 'documents', 'downloads', 'pictures', 'music', 'videos']
  const places = ids.flatMap((id) => {
    const path = app.getPath(id)
    return existsSync(path) ? [{ id, path }] : []
  })
  return { places, volumes: await listVolumes() }
})
handle('volumes:eject', (path: string) => ejectVolume(path))

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
    if (q.mode === 'tag') return host ? { hits: [], truncated: false, error: t('I tag esistono solo per i file del Mac') } : await runTagSearch(cwd, q, ac.signal, onHits)
    return await (host ? runSearchRemote(host, cwd, q, ac.signal, onHits) : runSearch(cwd, q, ac.signal, onHits))
  } finally {
    if (timer) clearTimeout(timer) // what is left comes with the reply
    if (searches.get(tileId) === ac) searches.delete(tileId)
  }
})
// archives browsed as folders: each is extracted once into a cache that lives while some tab (or the clipboard) holds it
const archiveBase = () => join(app.getPath('userData'), 'archives')
const removeCache = async (host: string | null, root: string) => {
  if (!ownedCache(host, root, archiveBase())) return // the renderer names these paths: only ours are deleted
  if (host) await sshRun(host, 'rm -rf -- ' + shQuote(root))
  else {
    // moved away at once: an open of the same archive while the rm runs must not reuse what is being deleted (sweep clears leftovers)
    const gone = `${root}.gone-${randomBytes(4).toString('hex')}`
    try {
      renameSync(root, gone)
    } catch {
      return // already gone
    }
    await rm(gone, { recursive: true, force: true })
  }
}
const archives = new ArchiveCaches({ remove: removeCache })
const opening = new Map<string, AbortController>() // one open per holder: a new one cancels the previous
handle('archive:open', async (host: string | null, archive: string, holder: string) => {
  opening.get(holder)?.abort()
  const ac = new AbortController()
  opening.set(holder, ac)
  try {
    let root: string
    let hidden: number
    if (host) {
      root = remoteCacheDir()
      const r = await sshRun(host, remoteOpenScript(archive, root), { timeout: 10 * 60_000, signal: ac.signal })
      if (!r.ok) {
        await removeCache(host, root).catch(() => {}) // a cancel or a lost connection may have left the dir
        return { ok: false, error: ac.signal.aborted ? t('Annullato') : r.error }
      }
      const [n, real] = r.out.toString().split('\n')
      hidden = Number(n) || 0
      if (ownedCache(host, real, archiveBase())) root = real // as listings show it: /tmp may be a link (/private/tmp on macOS)
    } else {
      await mkdir(archiveBase(), { recursive: true })
      ;({ root, hidden } = await openLocal(archiveBase(), archive, ac.signal))
    }
    if (ac.signal.aborted) {
      if (host) await removeCache(host, root).catch(() => {}) // a local cache stays for the next open
      return { ok: false, error: t('Annullato') }
    }
    archives.acquire(host, root, holder)
    return { ok: true, root, hidden }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  } finally {
    if (opening.get(holder) === ac) opening.delete(holder)
  }
})
handle('archive:cancel', (holder: string) => opening.get(holder)?.abort())
handle('archive:hold', (holder: string, host: string | null, root: string) => ownedCache(host, root, archiveBase()) && archives.acquire(host, root, holder))
handle('archive:release', (holder: string, root?: string) => archives.release(holder, root))
handle('archive:releaseAll', () => archives.releaseAll())
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
  const settings: MenuItemConstructorOptions = { label: t('Impostazioni…'), accelerator: p === 'darwin' ? 'Cmd+,' : 'Ctrl+,', click: send('settings:open') }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      p === 'darwin'
        ? { role: 'appMenu', submenu: [{ role: 'about' }, { label: t('Controlla aggiornamenti…'), click: () => void checkNow() }, settings, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }
        : { label: 'Cassetto', submenu: [{ label: t('Controlla aggiornamenti…'), click: () => void checkNow() }, settings, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      {
        label: t('Archivio'),
        submenu: [
          { label: t('Nuovo tab'), accelerator: shortcut('T', p), click: send('tile:new') },
          { label: t('Nuovo terminale qui'), accelerator: 'CmdOrCtrl+Alt+T', click: send('terminal:new') },
          // shown here, handled by the renderer: inside the editor Cmd+K starts chords (Cmd+K Cmd+U)
          { label: t('Connetti a server SSH…'), accelerator: shortcut('K', p), registerAccelerator: false, click: send('ssh:open') },
          { label: t('Barra azioni…'), accelerator: barShortcut, registerAccelerator: false, click: send('palette:open', 'bar') },
          { label: t('Vai a file…'), accelerator: shortcut('P', p), registerAccelerator: false, click: send('palette:open', 'files') },
          ...(p === 'darwin' ? [{ label: t('Comandi…'), accelerator: 'Cmd+Shift+P', registerAccelerator: false, click: send('palette:open', 'commands') }] : []),
          { type: 'separator' },
          // shown here, handled by the renderer
          { label: t('Tab successivo'), accelerator: shortcut(']', p), registerAccelerator: false, click: send('tile:cycle', 1) },
          { label: t('Tab precedente'), accelerator: shortcut('[', p), registerAccelerator: false, click: send('tile:cycle', -1) },
          { label: t('Chiudi tab'), accelerator: shortcut('W', p), click: send('tile:close') }
        ]
      },
      { label: t('Vista'), submenu: [{ role: 'toggleDevTools' }, { role: 'togglefullscreen' }] },
      p === 'darwin' ? { role: 'windowMenu' } : { label: t('Finestra'), submenu: [{ role: 'minimize', registerAccelerator: false }] }
    ])
  )
}

let started = false // the first window is up: until then a reopen would make a second one
const reopen = () => void (started && !win && createWindow())
app.on('second-instance', () => {
  if (!win) return reopen() // closed while transfers ran, and the quit was cancelled
  if (win.isMinimized()) win.restore()
  win.focus()
})
app.whenReady().then(() => {
  if (!single) return
  // the language of menus and messages; a change in Impostazioni applies at the next start
  setLang(resolveLang(loadState(stateFile()).settings?.language, app.getLocale()))
  const root = join(__dirname, '../renderer')
  protocol.handle('app', req => {
    const file = appFile(root, req.url)
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response('Non trovato', { status: 404 })
  })
  protocol.handle('preview', req => serveMedia(media, req))
  // the page never needs camera, microphone, location, notifications…: Electron would grant them all by default
  session.defaultSession.setPermissionRequestHandler((_wc, permission, done) => done(permission === 'fullscreen'))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'fullscreen')
  barShortcut = loadState(stateFile()).settings?.barShortcut ?? DEFAULT_BAR
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png')) // the packaged app gets it from the bundle
  setMenu()
  sweep(archiveBase()).finally(() => ((started = true), createWindow())) // caches of a crashed run are not held by anyone
})
let asking = false // the dialog is open: further quits wait for the answer
let confirmed = false // Esci chosen: the quit goes through
app.on('before-quit', e => {
  if (!confirmed && queue.running()) {
    e.preventDefault()
    if (asking) return
    asking = true
    dialog
      .showMessageBox(win!, { type: 'warning', buttons: [t('Esci'), t('Annulla')], defaultId: 1, cancelId: 1, message: t('Ci sono trasferimenti in corso.'), detail: t('Uscendo verranno annullati.') })
      .then(async r => {
        asking = false
        if (r.response !== 0) return reopen() // the quit came from closing the window: bring it back
        confirmed = true
        queue.list().forEach(j => queue.cancel(j.id))
        for (let i = 0; i < 50 && queue.running(); i++) await new Promise(r => setTimeout(r, 100)) // up to 5 s to settle
        app.quit()
      })
    return
  }
  ptys.killAll()
  events?.then(stop => stop())
  events = null
})
let cleaned = false
// after the windows closed: a window's beforeunload (unsaved editor) may still cancel the quit in before-quit
app.on('will-quit', e => {
  if (cleaned || !single) return
  e.preventDefault() // the caches go first (remote ones over ssh), but never keep the user waiting long
  cleaned = true
  Promise.race([archives.releaseAll().then(() => sweep(archiveBase())), new Promise(r => setTimeout(r, 3000))]).finally(() => app.quit())
})
app.on('window-all-closed', () => app.quit())
app.on('activate', reopen)
