import { execFile } from 'node:child_process'
import { t } from '../shared/i18n'
import type { Account } from '../shared/types'

// ponytail: text parsing of cswap 0.26 and 0.29; if the format changes, fix it here
export function parseCswapList(text: string): Account[] {
  const accounts: Account[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('Running instances:')) break
    const head = line.match(/^\s*(\d+):\s+(?:.+? \()?([^\s()]+)\)?\s+\[([^\]]*)\]((?:\s+\([a-z]+\))*)/)
    if (head) {
      accounts.push({ slot: Number(head[1]), email: head[2], label: head[3], active: head[4].includes('(active)'), usage5h: null, usage7d: null })
      continue
    }
    const usage = line.match(/(5h|7d):\s+(\d+)%/)
    const last = accounts[accounts.length - 1]
    if (usage && last) last[usage[1] === '5h' ? 'usage5h' : 'usage7d'] = Number(usage[2])
  }
  return accounts
}

type List = { accounts: Account[]; error: string | null }
let last: { at: number; list: Promise<List> } | null = null
// one `cswap list` shared by the launches, the bar and the dialog asking within 10 s
export function listAccounts(path: string): Promise<List> {
  if (last && Date.now() - last.at < 10_000) return last.list
  const list = new Promise<List>(resolve =>
    execFile('cswap', ['list'], { timeout: 15000, env: { ...process.env, PATH: path } }, (err, stdout) =>
      resolve(err ? { accounts: [], error: t('cswap non disponibile: {error}', { error: err.message }) } : { accounts: parseCswapList(stdout), error: null })
    )
  )
  last = { at: Date.now(), list }
  return list
}
