import { execFile } from 'node:child_process'
import { lstat, readdir, readFile, realpath } from 'node:fs/promises'
import { userInfo } from 'node:os'
import { basename, join } from 'node:path'
import type { Volume } from '../../shared/types'

export function parseMounts(procMounts: string, user: string): Volume[] {
  const roots = [`/media/${user}/`, `/run/media/${user}/`, '/mnt/']
  const out: Volume[] = []
  for (const line of procMounts.split('\n')) {
    const raw = line.split(' ')[1]
    if (!raw) continue
    const path = raw.replace(/\\040/g, ' ')
    if (roots.some((r) => path.startsWith(r) && path.length > r.length)) out.push({ name: basename(path), path })
  }
  return out
}

// never throws: a platform without the capability just shows no disks
export async function listVolumes(): Promise<Volume[]> {
  try {
    if (process.platform === 'darwin') {
      const out: Volume[] = []
      for (const name of await readdir('/Volumes')) {
        const path = join('/Volumes', name)
        // the startup disk shows up as a symlink to /
        if ((await lstat(path)).isSymbolicLink() && (await realpath(path)) === '/') continue
        out.push({ name, path })
      }
      return out
    }
    return parseMounts(await readFile('/proc/mounts', 'utf8'), userInfo().username)
  } catch {
    return []
  }
}

// error text, or null when the volume was ejected
export function ejectVolume(path: string): Promise<string | null> {
  const [cmd, args] = process.platform === 'darwin' ? ['diskutil', ['eject', path]] : ['gio', ['mount', '-e', path]]
  return new Promise((resolve) =>
    execFile(cmd as string, args as string[], (err, _o, stderr) => resolve(err ? stderr.trim() || err.message : null))
  )
}
