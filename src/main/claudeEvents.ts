import { chmodSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { ClaudeEvent } from '../shared/types'

// Receives the curl calls of the Claude hooks: POST/GET /<event>/<tileId>
export async function startEventServer(sock: string, onEvent: (tileId: string, e: ClaudeEvent) => void): Promise<() => void> {
  tryRm(sock) // stale socket from a crashed run
  const server = createServer((req, res) => {
    const m = req.url?.match(/^\/(prompt|tool|permission|stop)\/([\w-]+)$/)
    if (m) onEvent(m[2], m[1] as ClaudeEvent)
    res.writeHead(m ? 204 : 404).end()
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(sock, () => {
      chmodSync(sock, 0o600) // only our user's Claudes may report
      resolve(() => {
        server.close()
        tryRm(sock)
      })
    })
  })
}

// a file we cannot remove (another user's, in a shared sticky /tmp) must not stop the server
export function tryRm(f: string): void {
  try {
    rmSync(f, { force: true })
  } catch {
    // not ours
  }
}

// Sockets left in tmpdir by crashed runs: cassetto-<pid>.sock whose process no longer exists.
export function staleSockets(files: string[], isAlive: (pid: number) => boolean): string[] {
  return files.filter(f => {
    const m = f.match(/^cassetto-(\d+)\.sock$/)
    return !!m && !isAlive(Number(m[1]))
  })
}

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' // exists but not ours
  }
}
