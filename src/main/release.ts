import { app, dialog } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { chmod, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { shQuote } from './ssh'
import { t } from '../shared/i18n'

// what an update is doing, for the banner under the top bar; progress 0…1, null when it cannot be measured
export type UpdateStatus = { label: string; progress: number | null } | null

const LATEST = 'https://api.github.com/repos/mkis78/cassetto/releases/latest'
type Asset = { name: string; browser_download_url: string; digest?: string | null }
export type Release = { version: string; url: string; sha256: string | null }

const nums = (v: string) => v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)

export function newerVersion(current: string, tag: string): boolean {
  const [a, b] = [nums(current), nums(tag)]
  for (let i = 0; i < 3; i++) if ((b[i] ?? 0) !== (a[i] ?? 0)) return (b[i] ?? 0) > (a[i] ?? 0)
  return false
}

// the download for this machine: the macOS zip for its processor (the dmg needs mounting), or the Linux AppImage.
// Names follow artifactName in package.json, ${productName}-${version}-${arch}.${ext}: change both together.
export function pickAsset(assets: Asset[], platform: string, arch: string): Asset | null {
  const suffix = platform === 'darwin' ? `-${arch}.zip` : platform === 'linux' ? '.AppImage' : null
  return (suffix && assets.find(a => a.name.endsWith(suffix))) || null
}

// only an installed app can replace itself: not `npm run dev`, not an AppImage-less Linux run
export const canSelfUpdate = (e: { packaged: boolean; platform: string; appImage: string | undefined }): boolean =>
  e.packaged && (e.platform === 'darwin' || (e.platform === 'linux' && !!e.appImage))

// any failure (offline, rate limit, bad JSON, a private repository) is just "no update"
export async function checkRelease(current: string): Promise<Release | null> {
  try {
    const res = await fetch(LATEST, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) return null
    const r = (await res.json()) as { tag_name: string; assets: Asset[] }
    const a = pickAsset(r.assets, process.platform, process.arch)
    const sha256 = /^sha256:([0-9a-f]{64})$/i.exec(a?.digest ?? '')?.[1]?.toLowerCase() ?? null
    return a && newerVersion(current, r.tag_name) ? { version: r.tag_name.replace(/^v/, ''), url: a.browser_download_url, sha256 } : null
  } catch {
    return null
  }
}

export const downloadStatus = (received: number, total: number): UpdateStatus =>
  total > 0 ? { label: t('Download della nuova versione…'), progress: Math.floor((received / total) * 100) / 100 } : { label: t('Download della nuova versione: {mb} MB', { mb: Math.round(received / 1e6) }), progress: null }

export const fileSha256 = (file: string) =>
  new Promise<string>((ok, ko) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', ko)
  })

// Waits for `pid` to exit, then swaps in the new bundle; a failed copy leaves the old app in place.
export function swapScript(pid: number, built: string, target: string, copy = 'ditto'): string {
  const [b, t, tmp] = [built, target, `${target}.new`].map(shQuote)
  return `while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done; rm -rf ${tmp} && ${copy} ${b} ${tmp} && rm -rf ${t} && mv ${tmp} ${t}`
}

let installing = false // a second install would race the first on `${target}.new`

// download, check, unpack, then quit and let a detached shell swap the app and reopen it
export async function installRelease(r: Release, report: (s: UpdateStatus) => void): Promise<void> {
  if (installing) return
  installing = true
  try {
    const dir = await mkdtemp(join(app.getPath('temp'), 'cassetto-update-'))
    const file = join(dir, r.url.split('/').pop() || 'download')
    report({ label: t('Download della nuova versione…'), progress: 0 })
    const res = await fetch(r.url)
    if (!res.ok || !res.body) throw new Error(t('Download fallito ({status})', { status: res.status }))
    const total = Number(res.headers.get('content-length')) || 0
    let received = 0
    let shown = ''
    const body = Readable.fromWeb(res.body as never)
    body.on('data', (c: Buffer) => {
      const s = downloadStatus((received += c.length), total)
      if (JSON.stringify(s) === shown) return // one message per percent, not per chunk
      shown = JSON.stringify(s)
      report(s)
    })
    await pipeline(body, createWriteStream(file))
    // what GitHub says the file is: a broken or swapped download never replaces the app
    report({ label: t('Verifica…'), progress: null })
    if (r.sha256 && (await fileSha256(file)) !== r.sha256) throw new Error(t("Il file scaricato non corrisponde a quello pubblicato (SHA-256 diverso): l'aggiornamento è stato annullato."))
    report({ label: t('Installazione…'), progress: null })
    let swap: string
    if (process.platform === 'darwin') {
      await promisify(execFile)('ditto', ['-x', '-k', file, dir])
      const built = join(dir, 'Cassetto.app')
      if (!existsSync(built)) throw new Error(t("L'archivio scaricato non contiene Cassetto.app"))
      const target = resolve(app.getPath('exe'), '../../..')
      swap = `${swapScript(process.pid, built, target)}; open ${shQuote(target)}`
    } else {
      const target = process.env.APPIMAGE!
      await chmod(file, 0o755)
      swap = `${swapScript(process.pid, file, target, 'cp -p')}; ${shQuote(target)}`
    }
    report({ label: t('Riavvio…'), progress: 1 })
    spawn('/bin/sh', ['-c', swap], { detached: true, stdio: 'ignore' }).unref()
    app.quit()
  } catch (err) {
    installing = false // let the user retry
    report(null)
    dialog.showErrorBox(t('Aggiornamento non riuscito'), (err as Error).message)
  }
}
