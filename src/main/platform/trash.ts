import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Trashed } from '../../shared/types'

// NSFileManager reports the exact path in the Trash (renamed duplicates included); needs no Full Disk Access.
// Paths come in as argv, never in the script text.
const SCRIPT = `use framework "Foundation"
on run argv
set fm to current application's NSFileManager's defaultManager()
set out to {}
repeat with p in argv
set {ok, outURL, err} to fm's trashItemAtURL:(current application's NSURL's fileURLWithPath:(contents of p)) resultingItemURL:(reference) |error|:(reference)
if ok then
set end of out to (outURL's |path|()) as text
else
set end of out to "!" & ((err's localizedDescription()) as text)
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

// the item in the Trash that came from `original`: the newest deletion wins
export async function findTrashed(original: string, trashDirs: string[]): Promise<string | null> {
  let best: { file: string; date: string } | null = null
  for (const dir of trashDirs) {
    const names = await readdir(join(dir, 'info')).catch(() => [] as string[])
    for (const n of names) {
      if (!n.endsWith('.trashinfo')) continue
      const info = parseTrashInfo(await readFile(join(dir, 'info', n), 'utf8').catch(() => ''))
      if (info?.path === original && (!best || info.date > best.date)) best = { file: join(dir, 'files', n.slice(0, -'.trashinfo'.length)), date: info.date }
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
    const dirs = [join(homedir(), '.local/share/Trash'), ...(top ? [join(top, `.Trash-${uid}`), join(top, '.Trash', String(uid))] : [])]
    out.push({ path, trashed: (await findTrashed(path, dirs).catch(() => null)) ?? undefined })
  }
  return out
}

const trashDarwin = (paths: string[]) =>
  new Promise<Trashed[]>(resolve =>
    execFile('osascript', ['-e', SCRIPT, ...paths], (err, stdout) => {
      const lines = stdout.replace(/\n$/, '').split('\n')
      resolve(paths.map((path, i) => (lines[i]?.startsWith('!') ? { path, error: lines[i].slice(1) } : lines[i] ? { path, trashed: lines[i] } : { path, error: err?.message ?? 'trash failed' })))
    })
  )

// to the Trash, saying where each item went (same order as paths)
export async function trashItems(paths: string[]): Promise<Trashed[]> {
  if (!paths.length) return []
  return process.platform === 'darwin' ? trashDarwin(paths) : trashLinux(paths)
}
