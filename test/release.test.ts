import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

const errors: string[] = []
vi.mock('electron', () => ({ app: { getPath: () => require('node:os').tmpdir(), getVersion: () => '0.1.0', quit: () => {} }, dialog: { showErrorBox: (_t: string, m: string) => errors.push(m) } }))
const { canSelfUpdate, checkRelease, downloadStatus, fileSha256, installRelease, newerVersion, pickAsset, swapScript } = await import('../src/main/release')

afterEach(() => vi.unstubAllGlobals())

test('version compare', () => {
  expect(newerVersion('0.1.0', 'v0.2.0')).toBe(true)
  expect(newerVersion('0.10.0', 'v0.9.0')).toBe(false)
  expect(newerVersion('0.2.0', 'v0.2.0')).toBe(false)
  expect(newerVersion('1.2.3', 'v1.2.10')).toBe(true)
})

test('download status: the share downloaded, or megabytes when the size is unknown', () => {
  expect(downloadStatus(84e6, 200e6)!.progress).toBe(0.42)
  expect(downloadStatus(12.4e6, 0)).toEqual({ label: 'Download della nuova versione: 12 MB', progress: null })
})

test('picks the asset for the platform', () => {
  const a = ['Cassetto-0.2.0-arm64.dmg', 'Cassetto-0.2.0-arm64-mac.zip', 'Cassetto-0.2.0-x86_64.AppImage'].map(name => ({ name, browser_download_url: `u/${name}` }))
  expect(pickAsset(a, 'darwin')?.name).toBe('Cassetto-0.2.0-arm64-mac.zip')
  expect(pickAsset(a, 'linux')?.name).toBe('Cassetto-0.2.0-x86_64.AppImage')
  expect(pickAsset([], 'linux')).toBeNull()
})

test('self-update only for installed builds that can be replaced', () => {
  expect(canSelfUpdate({ packaged: false, platform: 'darwin', appImage: undefined })).toBe(false)
  expect(canSelfUpdate({ packaged: true, platform: 'darwin', appImage: undefined })).toBe(true)
  expect(canSelfUpdate({ packaged: true, platform: 'linux', appImage: undefined })).toBe(false)
})

test('a failed check is just "no update"', async () => {
  for (const f of [async () => new Response('', { status: 404 }), async () => { throw new Error('offline') }, async () => new Response('{nope')]) {
    vi.stubGlobal('fetch', f)
    expect(await checkRelease('0.1.0')).toBeNull()
  }
})

test('a newer release with a matching asset is reported, with its SHA-256', async () => {
  const sha = 'ab'.repeat(32)
  const body = { tag_name: 'v0.3.0', assets: [{ name: 'Cassetto-0.3.0-arm64-mac.zip', browser_download_url: 'u/z', digest: `sha256:${sha.toUpperCase()}` }] }
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body)))
  const p = process.platform
  Object.defineProperty(process, 'platform', { value: 'darwin' })
  try {
    expect(await checkRelease('0.1.0')).toEqual({ version: '0.3.0', url: 'u/z', sha256: sha })
    expect(await checkRelease('0.3.0')).toBeNull()
  } finally {
    Object.defineProperty(process, 'platform', { value: p })
  }
})

test('a download that does not match its SHA-256 is refused before anything is replaced', async () => {
  vi.stubGlobal('fetch', async () => new Response('contenuto alterato'))
  const steps: string[] = []
  await installRelease({ version: '9.9.9', url: 'u/Cassetto-9.9.9-arm64-mac.zip', sha256: '00'.repeat(32) }, s => steps.push(s?.label ?? 'fine'))
  expect(errors.pop()).toMatch(/SHA-256 diverso/)
  expect(steps).not.toContain('Installazione…')
  expect(steps.at(-1)).toBe('fine')
})

test('file hash and the swap script', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'csha-')), 'x')
  writeFileSync(f, 'ciao')
  expect(await fileSha256(f)).toBe('b133a0c0e9bee3be20163d2ad31d6248db292aa6dcb1ee087a2aa50e0fc75ae2')
  expect(swapScript(42, "/tmp/it's/Cassetto.app", '/Applications/Cassetto.app')).toBe(
    "while kill -0 42 2>/dev/null; do sleep 0.2; done; rm -rf '/Applications/Cassetto.app.new' && ditto '/tmp/it'\\''s/Cassetto.app' '/Applications/Cassetto.app.new' && rm -rf '/Applications/Cassetto.app' && mv '/Applications/Cassetto.app.new' '/Applications/Cassetto.app'"
  )
})
