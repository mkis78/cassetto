import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { AppInfo } from '../../shared/types'

// NSWorkspace lists the apps for each file, default first; one app path per line, a blank line after each file.
// Paths come in as argv, never in the script text.
const SCRIPT = `use framework "Foundation"
on run argv
set ws to current application's NSWorkspace's sharedWorkspace()
set out to {}
repeat with p in argv
set u to current application's NSURL's fileURLWithPath:(contents of p)
set d to (ws's URLForApplicationToOpenURL:u)
if d is not missing value then set end of out to (d's |path|()) as text
repeat with a in (ws's URLsForApplicationsToOpenURL:u)
set end of out to (a's |path|()) as text
end repeat
set end of out to ""
end repeat
set AppleScript's text item delimiters to linefeed
return out as text
end run`

// "Default application for “t”: x.desktop", then "Registered applications:" and tab-indented ids (names may hold spaces)
export function parseGioMime(out: string): { default: string | null; apps: string[] } {
  const def = /^Default application for [^:\n]*: (.+)$/m.exec(out)?.[1].trim() ?? null
  const reg = /^Registered applications:\n((?:\t.*\n?)*)/m.exec(out)?.[1] ?? ''
  return { default: def, apps: reg.split('\n').filter(l => l.startsWith('\t')).map(l => l.trim()) }
}

// the [Desktop Entry] group only: [Desktop Action x] has its own Name=
export function parseDesktopEntry(text: string): { name: string; noDisplay: boolean } | null {
  let inEntry = false
  let name: string | null = null
  let noDisplay = false
  for (const line of text.split('\n')) {
    if (line.startsWith('[')) inEntry = line.trim() === '[Desktop Entry]'
    else if (inEntry && line.startsWith('Name=') && name === null) name = line.slice(5).trim()
    else if (inEntry && line.trim() === 'NoDisplay=true') noDisplay = true
  }
  return name === null ? null : { name, noDisplay }
}

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) => execFile(cmd, args, { maxBuffer: 8 << 20 }, (err, out) => (err ? reject(err) : resolve(out))))

// the osascript output as one app list per file (each ends at a blank line)
export function parseAppLists(out: string): string[][] {
  const lists: string[][] = [[]]
  for (const l of out.replace(/\n$/, '').split('\n')) l === '' ? lists.push([]) : lists[lists.length - 1].push(l)
  return lists.slice(0, -1)
}

// default first (the first file's), then only what every file lists
export function common(lists: string[][]): string[] {
  const [first, ...rest] = lists
  return [...new Set(first ?? [])].filter(a => rest.every(l => l.includes(a)))
}

const cache = new Map<string, string[]>() // content type (linux) or extension (macOS) → app ids, for the session
const infos = new Map<string, AppInfo>()
const keyOf = (p: string): string => {
  const e = /\.([^./]+)$/.exec(basename(p))
  return e ? e[1].toLowerCase() : p
}

async function lookupDarwin(paths: string[]): Promise<string[][]> {
  const todo = [...new Map(paths.map(p => [keyOf(p), p])).entries()].filter(([k]) => !cache.has(k))
  if (todo.length) {
    const lists = parseAppLists(await run('osascript', ['-e', SCRIPT, ...todo.map(([, p]) => p)]))
    todo.forEach(([k], i) => cache.set(k, lists[i] ?? []))
  }
  return paths.map(p => cache.get(keyOf(p))!)
}

const dataDirs = (): string[] =>
  [process.env.XDG_DATA_HOME || join(homedir(), '.local/share'), ...(process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':')].filter(Boolean).map(d => join(d, 'applications'))

async function lookupLinux(paths: string[]): Promise<string[][]> {
  const out: string[][] = []
  for (const p of paths) {
    const type = /standard::content-type: (.+)/.exec(await run('gio', ['info', '-a', 'standard::content-type', p]))?.[1].trim()
    if (!type) {
      out.push([])
      continue
    }
    if (!cache.has(type)) {
      const m = parseGioMime(await run('gio', ['mime', type]))
      const files: string[] = []
      for (const id of [...(m.default ? [m.default] : []), ...m.apps]) {
        for (const d of dataDirs()) {
          const f = join(d, id)
          const e = await readFile(f, 'utf8').then(parseDesktopEntry, () => null)
          if (!e) continue
          if (!e.noDisplay) (infos.set(f, { id: f, name: e.name }), files.push(f))
          break
        }
      }
      cache.set(type, files)
    }
    out.push(cache.get(type)!)
  }
  return out
}

// the apps that can open every one of paths, the default first; [] on any failure
export async function appsFor(paths: string[]): Promise<AppInfo[]> {
  if (!paths.length) return []
  try {
    const ids = common(await (process.platform === 'darwin' ? lookupDarwin(paths) : lookupLinux(paths)))
    const { app } = await import('electron') // lazy: the parsers above must load without Electron
    return await Promise.all(
      ids.map(async id => {
        let info = infos.get(id)
        if (!info) {
          info = { id, name: basename(id).replace(/\.app$/, '') }
          // ponytail: Linux has no app icons (a .desktop Icon= needs a theme lookup); add when wanted
          info.icon = await app.getFileIcon(id, { size: 'normal' }).then(i => i.toDataURL(), () => undefined)
          infos.set(id, info)
        }
        return info
      })
    )
  } catch {
    return []
  }
}

// null on success, else what went wrong
export function openWith(appId: string, paths: string[]): Promise<string | null> {
  const [cmd, args] = process.platform === 'darwin' ? ['open', ['-a', appId, '--', ...paths]] : ['gio', ['launch', appId, ...paths]]
  return new Promise(resolve => execFile(cmd, args, err => resolve(err ? err.message : null)))
}
