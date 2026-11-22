import { lstat, open, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sortEntries } from '../shared/sortEntries'
import { imageType } from '../shared/format'
import type { ListResult, Preview, ReadResult, WriteResult } from '../shared/types'
import { t } from '../shared/i18n'
import { mediaOf, type MediaTokens } from './mediaPreview'

export async function listLocal(path: string): Promise<ListResult> {
  try {
    const dirents = await readdir(path, { withFileTypes: true })
    const entries = await Promise.all(
      dirents.map(async d => {
        // stat follows symlinks, so a link to a folder is a folder; a broken link falls back to the link itself
        const st = await stat(join(path, d.name)).catch(() => lstat(join(path, d.name)).catch(() => null))
        return { name: d.name, dir: d.isDirectory() || !!st?.isDirectory(), ...(st && { size: st.size, mtime: Math.round(st.mtimeMs) }) }
      })
    )
    return { ok: true, listing: { path, entries: sortEntries(entries) } }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}


// how much of a file the preview reads; one byte more than this tells it the file goes on
export const previewLimit = (path: string): number => (imageType(path) ? 10 * 1024 * 1024 : 64 * 1024)

// the first previewLimit(path) + 1 bytes of a file, as something the renderer can show
export function toPreview(path: string, buf: Buffer): Preview {
  const limit = previewLimit(path)
  const type = imageType(path)
  if (type) return buf.length > limit ? { kind: 'error', error: t("Immagine troppo grande per l'anteprima") } : { kind: 'image', src: `data:${type};base64,${buf.toString('base64')}` }
  if (buf.subarray(0, 8000).includes(0)) return { kind: 'binary' } // git's rule: a NUL near the start means binary
  return { kind: 'text', text: buf.subarray(0, limit).toString('utf8'), truncated: buf.length > limit }
}

export async function previewLocal(path: string, tokens: MediaTokens): Promise<Preview> {
  try {
    const media = mediaOf(path)
    if (media) {
      const f = await open(path) // throws now if it can't be read, rather than failing later as a bad format
      const isFile = await f.stat().then(st => st.isFile(), () => false).finally(() => f.close())
      if (!isFile) return { kind: 'error', error: t('Non è un file') }
      return { kind: media.kind, src: tokens.add(path) } // read by the renderer over preview://, in pieces
    }
    const f = await open(path)
    try {
      const buf = Buffer.alloc(previewLimit(path) + 1)
      const { bytesRead } = await f.read(buf, 0, buf.length, 0)
      return toPreview(path, buf.subarray(0, bytesRead))
    } finally {
      await f.close()
    }
  } catch (e) {
    return { kind: 'error', error: (e as Error).message }
  }
}

// the editor opens files up to this size; reading one byte more tells a bigger file apart
export const EDIT_LIMIT = 20 * 1024 * 1024

// the first EDIT_LIMIT + 1 bytes of a file, as text for the editor
export function toText(buf: Buffer): ReadResult {
  if (buf.length > EDIT_LIMIT) return { ok: false, error: t("File troppo grande per l'editor (oltre {mb} MB)", { mb: EDIT_LIMIT / 1024 / 1024 }), large: true }
  if (buf.subarray(0, 8000).includes(0)) return { ok: false, error: t('File binario'), binary: true }
  return { ok: true, text: buf.toString('utf8') }
}

export async function readLocal(path: string): Promise<ReadResult> {
  try {
    if ((await stat(path)).size > EDIT_LIMIT) return toText(Buffer.alloc(EDIT_LIMIT + 1))
    return toText(await readFile(path))
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// in place, so the file keeps its permissions, owner and any hard links
export async function writeLocal(path: string, text: string): Promise<WriteResult> {
  try {
    await writeFile(path, text)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
