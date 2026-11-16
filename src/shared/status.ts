// The status bar of a files tile: what the folder holds, what is selected, how full the disk is.
import type { DirEntry } from './types'
import { formatSize } from './format'

const KINDS: Record<string, string> = {
  pdf: 'Documento PDF', doc: 'Documento Word', docx: 'Documento Word', xls: 'Foglio Excel', xlsx: 'Foglio Excel', ppt: 'Presentazione PowerPoint', pptx: 'Presentazione PowerPoint',
  pages: 'Documento Pages', numbers: 'Foglio Numbers', key: 'Presentazione Keynote', odt: 'Documento OpenDocument', ods: 'Foglio OpenDocument', csv: 'Tabella CSV',
  txt: 'Testo', md: 'Markdown', rtf: 'Testo RTF', json: 'JSON', xml: 'XML', yml: 'YAML', yaml: 'YAML', html: 'Pagina HTML', css: 'Foglio di stile CSS',
  js: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript React', jsx: 'JavaScript React', py: 'Python', sh: 'Script shell', swift: 'Swift', go: 'Go', rs: 'Rust', java: 'Java', c: 'C', h: 'Header C',
  png: 'Immagine PNG', jpg: 'Immagine JPEG', jpeg: 'Immagine JPEG', gif: 'Immagine GIF', webp: 'Immagine WebP', heic: 'Immagine HEIC', svg: 'Immagine SVG', tiff: 'Immagine TIFF', bmp: 'Immagine BMP', ico: 'Icona',
  mp3: 'Audio MP3', wav: 'Audio WAV', m4a: 'Audio AAC', flac: 'Audio FLAC', mp4: 'Video MPEG-4', mov: 'Filmato QuickTime', mkv: 'Video Matroska', avi: 'Video AVI',
  zip: 'Archivio ZIP', gz: 'Archivio gzip', tgz: 'Archivio tar.gz', tar: 'Archivio tar', rar: 'Archivio RAR', '7z': 'Archivio 7-Zip',
  dmg: 'Immagine disco', pkg: 'Pacchetto di installazione', app: 'Applicazione', exe: 'Programma Windows', log: 'Log', ttf: 'Font', otf: 'Font', woff2: 'Font'
}

// what a file is, from its extension, the way Finder names it
export function kindOf(name: string, dir: boolean): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (dir) return ext === 'app' ? 'Applicazione' : 'Cartella'
  return KINDS[ext] ?? (ext ? `File ${ext.toUpperCase()}` : 'File')
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString('it-IT')} ${n === 1 ? one : many}`
// the bytes of the files among `entries`, or null when the listing has no sizes (some remote hosts)
const filesSize = (entries: DirEntry[]) => {
  const files = entries.filter(e => !e.dir)
  return files.length && files.every(e => e.size !== undefined) ? files.reduce((s, e) => s + e.size!, 0) : null
}

// "3 cartelle, 12 file · 45,2 MB · 4 nascosti": the size counts the files right here, not what is inside the folders
export function folderSummary(shown: DirEntry[], hidden: number): string {
  const dirs = shown.filter(e => e.dir).length
  const parts = [`${count(dirs, 'cartella', 'cartelle')}, ${count(shown.length - dirs, 'file', 'file')}`]
  const size = filesSize(shown)
  if (size !== null) parts.push(formatSize(size))
  if (hidden) parts.push(count(hidden, 'nascosto', 'nascosti'))
  return parts.join(' · ')
}

// several picked: how many, and what the files weigh (folders need "Calcola dimensione")
export function selectionSummary(picked: DirEntry[]): string {
  const dirs = picked.filter(e => e.dir).length
  const size = filesSize(picked)
  const what = dirs && dirs < picked.length ? ` (${count(picked.length - dirs, 'file', 'file')}, ${count(dirs, 'cartella', 'cartelle')})` : ''
  return `${count(picked.length, 'elemento selezionato', 'elementi selezionati')}${what}${size !== null ? ` · ${formatSize(size)}${dirs ? ' nei file' : ''}` : ''}`
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
export const diskSummary = (d: Disk) => `${formatSize(d.free)} liberi su ${formatSize(d.total)}`
