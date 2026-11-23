import { execFile } from 'node:child_process'
import { readlink } from 'node:fs/promises'

// lsof -Fn prints one field per line; the folder is the line starting with n
export function parseLsofCwd(out: string): string | null {
  const line = out.split('\n').find(l => l.startsWith('n'))
  return line ? line.slice(1) : null
}

// the current folder of a process (a shell after the user's cd): /proc on Linux, lsof on macOS; null when unknown
export function procCwd(pid: number): Promise<string | null> {
  if (process.platform === 'linux') return readlink(`/proc/${pid}/cwd`).catch(() => null)
  return new Promise(resolve => execFile('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { timeout: 3000 }, (_e, out) => resolve(parseLsofCwd(String(out ?? '')))))
}
