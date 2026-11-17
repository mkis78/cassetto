import { execFile } from 'node:child_process'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Trashed } from '../../shared/types'

// NSFileManager reports the exact path in the Trash (renamed duplicates included); needs no Full Disk Access.
// Paths come in as argv, never in the script text. One line per item: a file URL (a newline in a name is %0A)
// or ! and the error with its line breaks flattened, so a name can never shift the lines after it.
const SCRIPT = `use framework "Foundation"
on run argv
set fm to current application's NSFileManager's defaultManager()
set out to {}
repeat with p in argv
set {ok, outURL, err} to fm's trashItemAtURL:(current application's NSURL's fileURLWithPath:(contents of p)) resultingItemURL:(reference) |error|:(reference)
if ok then
set end of out to (outURL's absoluteString()) as text
else
set end of out to "!" & ((err's localizedDescription()'s stringByReplacingOccurrencesOfString:linefeed withString:" ") as text)
end if
end repeat
set AppleScript's text item delimiters to linefeed
return out as text
end run`

export function parseTrashInfo(text: string): { path: string; date: string } | null {
  const path = /^Path=(.*)$/m.exec(text)?.[1]
  const date = /^DeletionDate=(.*)$/m.exec(text)?.[1]
  if (path === undefined || date === undefined) return null
  try {
    return { path: decodeURIComponent(path.trim()), date: date.trim() }
  } catch {
    return null
  }
}

// the item in the Trash that came from `original`: the newest deletion wins.
// Each Trash comes with its mount top: in $topdir/.Trash-$uid, Path= is relative to it.
// ponytail: only info files named after the original (a renamed duplicate keeps the name, "x.2.txt"); a name the Trash shortened is missed
export async function findTrashed(original: string, trashDirs: [dir: string, top: string][]): Promise<string | null> {
  const stem = basename(original, extname(original))
  let best: { file: string; date: string } | null = null
  for (const [dir, top] of trashDirs) {
    const names = await readdir(join(dir, 'info')).catch(() => [] as string[])
    for (const n of names) {
      if (!n.endsWith('.trashinfo') || !n.startsWith(stem)) continue
      const info = parseTrashInfo(await readFile(join(dir, 'info', n), 'utf8').catch(() => ''))
      if (!info || (isAbsolute(info.path) ? info.path : join(top, info.path)) !== original || (best && info.date <= best.date)) continue
      const file = join(dir, 'files', n.slice(0, -'.trashinfo'.length))
      if (await lstat(file).then(() => true, () => false)) best = { file, date: info.date } // an info left behind by a restore has no file
    }
  }
  return best?.file ?? null
}

// the mount point holding p: walk up until the device changes
async function mountTop(p: string): Promise<string> {
  let cur = dirname(p)
  const dev = (await stat(cur)).dev
  for (;;) {
    const up = dirname(cur)
    if (up === cur || (await stat(up)).dev !== dev) return cur
    cur = up
  }
}

async function trashLinux(paths: string[]): Promise<Trashed[]> {
  const { shell } = await import('electron') // lazy: the parsers above must load without Electron
  const uid = process.getuid?.() ?? 0
  const out: Trashed[] = []
  for (const path of paths) {
    try {
      await shell.trashItem(path)
    } catch (e) {
      out.push({ path, error: (e as Error).message })
      continue
    }
    const top = await mountTop(path).catch(() => null)
    const dirs: [string, string][] = [[join(homedir(), '.local/share/Trash'), '/'], ...(top ? ([[join(top, `.Trash-${uid}`), top], [join(top, '.Trash', String(uid)), top]] as [string, string][]) : [])]
    out.push({ path, trashed: (await findTrashed(path, dirs).catch(() => null)) ?? undefined })
  }
  return out
}

const trashDarwin = (paths: string[]) =>
  new Promise<Trashed[]>(resolve =>
    execFile('osascript', ['-e', SCRIPT, ...paths], (err, stdout) => {
      const lines = stdout.replace(/\n$/, '').split('\n')
      // a folder's URL ends in /
      resolve(paths.map((path, i) => (lines[i]?.startsWith('!') ? { path, error: lines[i].slice(1) } : lines[i] ? { path, trashed: fileURLToPath(lines[i]).replace(/(.)\/$/, '$1') } : { path, error: err?.message ?? 'trash failed' })))
    })
  )

// to the Trash, saying where each item went (same order as paths)
export async function trashItems(paths: string[]): Promise<Trashed[]> {
  if (!paths.length) return []
  return process.platform === 'darwin' ? trashDarwin(paths) : trashLinux(paths)
}
