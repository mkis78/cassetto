// The status bar of a files tile: what the folder holds, what is selected, how full the disk is.
import { locale, t, tx } from './i18n'
import type { DirEntry } from './types'
import { formatSize } from './format'

const KINDS: Record<string, string> = {
  pdf: tx('Documento PDF'), doc: tx('Documento Word'), docx: tx('Documento Word'), xls: tx('Foglio Excel'), xlsx: tx('Foglio Excel'), ppt: tx('Presentazione PowerPoint'), pptx: tx('Presentazione PowerPoint'),
  pages: tx('Documento Pages'), numbers: tx('Foglio Numbers'), key: tx('Presentazione Keynote'), odt: tx('Documento OpenDocument'), ods: tx('Foglio OpenDocument'), csv: tx('Tabella CSV'),
  txt: tx('Testo'), md: tx('Markdown'), rtf: tx('Testo RTF'), json: tx('JSON'), xml: tx('XML'), yml: tx('YAML'), yaml: tx('YAML'), html: tx('Pagina HTML'), css: tx('Foglio di stile CSS'),
  js: tx('JavaScript'), ts: tx('TypeScript'), tsx: tx('TypeScript React'), jsx: tx('JavaScript React'), py: tx('Python'), sh: tx('Script shell'), swift: tx('Swift'), go: tx('Go'), rs: tx('Rust'), java: tx('Java'), c: tx('C'), h: tx('Header C'),
  png: tx('Immagine PNG'), jpg: tx('Immagine JPEG'), jpeg: tx('Immagine JPEG'), gif: tx('Immagine GIF'), webp: tx('Immagine WebP'), heic: tx('Immagine HEIC'), svg: tx('Immagine SVG'), tiff: tx('Immagine TIFF'), bmp: tx('Immagine BMP'), ico: tx('Icona'),
  mp3: tx('Audio MP3'), wav: tx('Audio WAV'), m4a: tx('Audio AAC'), flac: tx('Audio FLAC'), mp4: tx('Video MPEG-4'), mov: tx('Filmato QuickTime'), mkv: tx('Video Matroska'), avi: tx('Video AVI'),
  zip: tx('Archivio ZIP'), gz: tx('Archivio gzip'), tgz: tx('Archivio tar.gz'), tar: tx('Archivio tar'), rar: tx('Archivio RAR'), '7z': tx('Archivio 7-Zip'),
  dmg: tx('Immagine disco'), pkg: tx('Pacchetto di installazione'), app: tx('Applicazione'), exe: tx('Programma Windows'), log: tx('Log'), ttf: tx('Font'), otf: tx('Font'), woff2: tx('Font')
}

// what a file is, from its extension, the way Finder names it
export function kindOf(name: string, dir: boolean): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (dir) return ext === 'app' ? t('Applicazione') : t('Cartella')
  return KINDS[ext] ? t(KINDS[ext]) : ext ? t('File {ext}', { ext: ext.toUpperCase() }) : t('File')
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString(locale())} ${n === 1 ? t(one) : t(many)}`
// the bytes of the files among `entries`, or null when the listing has no sizes (some remote hosts)
const filesSize = (entries: DirEntry[]) => {
  const files = entries.filter(e => !e.dir)
  return files.length && files.every(e => e.size !== undefined) ? files.reduce((s, e) => s + e.size!, 0) : null
}

// "3 cartelle, 12 file · 45,2 MB · 4 nascosti": the size counts the files right here, not what is inside the folders
export function folderSummary(shown: DirEntry[], hidden: number): string {
  const dirs = shown.filter(e => e.dir).length
  const parts = [`${count(dirs, tx('cartella'), tx('cartelle'))}, ${count(shown.length - dirs, tx('file'), tx('file|plurale'))}`]
  const size = filesSize(shown)
  if (size !== null) parts.push(formatSize(size))
  if (hidden) parts.push(count(hidden, tx('nascosto'), tx('nascosti')))
  return parts.join(' · ')
}

// several picked: how many, and what the files weigh (folders need "Calcola dimensione")
export function selectionSummary(picked: DirEntry[]): string {
  const dirs = picked.filter(e => e.dir).length
  const size = filesSize(picked)
  const what = dirs && dirs < picked.length ? ` (${count(picked.length - dirs, tx('file'), tx('file|plurale'))}, ${count(dirs, tx('cartella'), tx('cartelle'))})` : ''
  return `${count(picked.length, tx('elemento selezionato'), tx('elementi selezionati'))}${what}${size !== null ? ` · ${formatSize(size)}${dirs ? ' ' + t('nei file') : ''}` : ''}`
}

export interface Disk {
  free: number // bytes the user can still write
  total: number
}

// `df -Pk <path>`: the second line is "filesystem 1024-blocks used available capacity mount"
export function parseDf(out: string): Disk | null {
  const cols = out.trim().split('\n')[1]?.trim().split(/\s+/) ?? []
  const total = Number(cols[1]) * 1024
  const free = Number(cols[3]) * 1024
  return cols.length >= 4 && Number.isFinite(total) && Number.isFinite(free) && total > 0 ? { free, total } : null
}

// `du -sk <path>`: "<kilobytes>\t<path>"; du goes on past folders it cannot read, so a partial total still counts
export function parseDu(out: string): number | null {
  const m = /^(\d+)\s/.exec(out.trim())
  return m ? Number(m[1]) * 1024 : null
}

// "120,4 GB liberi su 494 GB"
export const diskSummary = (d: Disk) => t('{free} liberi su {total}', { free: formatSize(d.free), total: formatSize(d.total) })
