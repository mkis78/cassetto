import { execFile, spawn } from 'node:child_process'
import type { OpResult, SearchHit, SearchQuery, SearchResult } from '../shared/types'
import { COLOR_NAMES, decodeTags, encodeTags, TAG_ATTR, type Tag } from '../shared/tags'
import { maxHits, pathFilter, patterns } from '../shared/query'
import { t } from '../shared/i18n'

// ponytail: macOS only, through its own xattr and find; Linux has user.xdg.tags when Cassetto goes there
export const tagsSupported = process.platform === 'darwin'

const run = (file: string, args: string[]) =>
  new Promise<{ out: string; err: string; code: number }>(ok =>
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024 }, (e, out, err) => ok({ out: out ?? '', err: err ?? '', code: e ? ((e as { code?: number }).code ?? 1) : 0 }))
  )

// `xattr -px` on several files prints "path: " then the bytes in hex lines; a file without tags only complains on stderr.
// /dev/null goes first so the output always has the headers, even for one file.
export function parseXattrHex(out: string): Map<string, Uint8Array> {
  const found = new Map<string, number[]>()
  let cur: number[] | null = null
  for (const line of out.split('\n')) {
    if (/^([0-9A-F]{2} ?)+$/i.test(line.trim())) cur?.push(...line.trim().split(/\s+/).map(h => parseInt(h, 16)))
    else if (line.endsWith(': ')) found.set(line.slice(0, -2), (cur = []))
  }
  return new Map([...found].map(([p, b]) => [p, Uint8Array.from(b)]))
}

// the tags of these files (absolute paths); files without tags are left out
export async function readTags(paths: string[]): Promise<Map<string, Tag[]>> {
  const out = new Map<string, Tag[]>()
  if (!tagsSupported) return out
  for (let i = 0; i < paths.length; i += 200) {
    const r = await run('xattr', ['-px', TAG_ATTR, '/dev/null', ...paths.slice(i, i + 200)])
    for (const [p, bytes] of parseXattrHex(r.out)) {
      const tags = decodeTags(bytes)
      if (tags.length) out.set(p, tags)
    }
  }
  return out
}

// the tags of what a folder holds, by name: one find for the tagged ones (usually few), then only those are read
export async function folderTags(dir: string): Promise<Map<string, Tag[]>> {
  if (!tagsSupported) return new Map()
  const r = await run('find', [dir, '-mindepth', '1', '-maxdepth', '1', '-xattrname', TAG_ATTR, '-print0'])
  const tagged = r.out.split('\0').filter(Boolean)
  const tags = await readTags(tagged)
  return new Map([...tags].map(([p, t]) => [p.slice(p.lastIndexOf('/') + 1), t]))
}

const hex = (b: Uint8Array) => [...b].map(x => x.toString(16).padStart(2, '0')).join('')

// add and take off tags on files and folders (a tag is its name: adding one already there changes its colour)
export async function editTags(paths: string[], change: { add?: Tag[]; remove?: string[] }): Promise<OpResult> {
  if (!tagsSupported) return { failed: paths.map(path => ({ path, error: t('I tag si usano solo sul Mac') })) }
  const now = await readTags(paths)
  const failed: OpResult['failed'] = []
  for (const path of paths) {
    const drop = new Set([...(change.remove ?? []), ...(change.add ?? []).map(t => t.name)])
    const tags = [...(now.get(path) ?? []).filter(t => !drop.has(t.name)), ...(change.add ?? [])]
    const r = tags.length ? await run('xattr', ['-wx', TAG_ATTR, hex(encodeTags(tags)), path]) : await run('xattr', ['-d', TAG_ATTR, path])
    // taking off tags a file never had is no failure
    if (r.code && !(tags.length === 0 && /No such xattr/i.test(r.err))) failed.push({ path, error: r.err.trim().replace(/^xattr: /, '') || t('xattr: codice {code}', { code: r.code }) })
  }
  return { failed }
}

// Search by tag below `cwd`: find lists what carries tags (subfolders, exclusions as for the other searches),
// in batches their tags are read, and what has a tag (or a tag colour) matching the text is a hit.
export async function runTagSearch(cwd: string, q: SearchQuery, signal?: AbortSignal, onHits?: (h: SearchHit[]) => void): Promise<SearchResult> {
  if (!tagsSupported) return { hits: [], truncated: false, error: t('La ricerca per tag funziona solo sul Mac') }
  const max = maxHits(q)
  const keep = pathFilter(q)
  const want = q.text.trim().toLowerCase()
  // a colour word in Italian or in the language of the interface (index 0, no colour, matches nothing)
  const colorMatch = (c: number) => c > 0 && (COLOR_NAMES[c].toLowerCase() === want || t(COLOR_NAMES[c]).toLowerCase() === want)
  const prune = patterns(q.exclude).filter(p => !p.includes('/'))
  const args = [
    '.',
    '-mindepth', '1',
    ...(q.subfolders === false ? ['-maxdepth', '1'] : []),
    ...(prune.length ? ['(', ...prune.flatMap((d, i) => [...(i ? ['-o'] : []), '-name', d]), ')', '-prune', '-o'] : []),
    '-xattrname', TAG_ATTR, '-print0'
  ]
  return new Promise(resolve => {
    const hits: SearchHit[] = []
    let truncated = false
    let rest = ''
    let pending: string[] = []
    let chain = Promise.resolve()
    const child = spawn('find', args, { cwd, signal })
    // read a batch of tagged paths, keep those whose tags match
    const flush = (paths: string[]) =>
      (chain = chain.then(async () => {
        if (truncated || !paths.length) return
        const tags = await readTags(paths.map(p => `${cwd.replace(/\/$/, '')}/${p}`))
        const batch: SearchHit[] = []
        for (const p of paths) {
          const found = tags.get(`${cwd.replace(/\/$/, '')}/${p}`) ?? []
          if (!keep(p) || !found.some(x => x.name.toLowerCase().includes(want) || colorMatch(x.color))) continue
          if (hits.length === max) return void ((truncated = true), child.kill())
          const hit = { path: p, tags: found }
          hits.push(hit)
          batch.push(hit)
        }
        if (batch.length) onHits?.(batch)
      }))
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d: string) => {
      const recs = (rest + d).split('\0')
      rest = recs.pop()!
      pending.push(...recs.filter(Boolean).map(r => r.replace(/^\.\//, '')))
      if (pending.length >= 100) flush(pending.splice(0))
    })
    child.on('error', err => resolve({ hits: err.name === 'AbortError' ? [] : hits, truncated: false, error: err.name === 'AbortError' ? null : err.message }))
    child.on('close', async () => {
      if (signal?.aborted) return resolve({ hits: [], truncated: false, error: null })
      if (rest) pending.push(rest.replace(/^\.\//, ''))
      await flush(pending.splice(0))
      // find exits 1 for folders it cannot read: the rest still counts, so no error for that
      resolve({ hits, truncated, error: null })
    })
  })
}
