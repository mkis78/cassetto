// Finder tags: what macOS keeps in the com.apple.metadata:_kMDItemUserTags extended attribute,
// a binary property list holding an array of "Name\nColor" strings. Read and written here as Finder does,
// so tags set in Cassetto show in the Finder and in Spotlight, and the other way round.

export interface Tag {
  name: string
  color: number // Finder's index: 0 none, 1 grey, 2 green, 3 purple, 4 blue, 5 yellow, 6 red, 7 orange
}

export const TAG_ATTR = 'com.apple.metadata:_kMDItemUserTags'

// Finder's own seven, with the names an Italian Finder gives them (it colours these by name)
export const FINDER_TAGS: Tag[] = [
  { name: 'Rosso', color: 6 },
  { name: 'Arancione', color: 7 },
  { name: 'Giallo', color: 5 },
  { name: 'Verde', color: 2 },
  { name: 'Blu', color: 4 },
  { name: 'Viola', color: 3 },
  { name: 'Grigio', color: 1 }
]
export const COLOR_NAMES = ['Nessuno', 'Grigio', 'Verde', 'Viola', 'Blu', 'Giallo', 'Rosso', 'Arancione']

export const parseTag = (s: string): Tag => {
  const i = s.lastIndexOf('\n')
  const color = i < 0 ? 0 : Number(s.slice(i + 1))
  return i < 0 || !Number.isInteger(color) || color < 0 || color > 7 ? { name: s, color: 0 } : { name: s.slice(0, i), color }
}
export const formatTag = (t: Tag) => `${t.name}\n${t.color}`

// --- binary property lists, only as far as an array of strings goes ---

// the strings of a bplist00 holding an array of strings; null for anything else
export function decodeStringArray(buf: Uint8Array): string[] | null {
  const ascii = (a: number, b: number) => String.fromCharCode(...buf.subarray(a, b))
  if (buf.length < 40 || ascii(0, 8) !== 'bplist00') return null
  const t = buf.length - 32
  const offSize = buf[t + 6]
  const refSize = buf[t + 7]
  const num = (at: number, size: number) => buf.subarray(at, at + size).reduce((n, b) => n * 256 + b, 0)
  const count = num(t + 8, 8)
  const top = num(t + 16, 8)
  const table = num(t + 24, 8)
  if (!offSize || !refSize || top >= count || table + count * offSize > t) return null
  const offset = (i: number) => num(table + i * offSize, offSize)
  // an object's length: the low nibble, or the int that follows when it is 0xF
  const length = (at: number): [number, number] => {
    const low = buf[at] & 0x0f
    if (low !== 0x0f) return [low, at + 1]
    const size = 1 << (buf[at + 1] & 0x0f)
    return [num(at + 2, size), at + 2 + size]
  }
  const string = (i: number): string | null => {
    const at = offset(i)
    const [len, start] = length(at)
    if (buf[at] >> 4 === 0x5) return ascii(start, start + len)
    if (buf[at] >> 4 === 0x6) {
      let s = ''
      for (let k = 0; k < len; k++) s += String.fromCharCode(buf[start + 2 * k] * 256 + buf[start + 2 * k + 1])
      return s
    }
    return null
  }
  const at = offset(top)
  if (buf[at] >> 4 !== 0xa) return null
  const [len, start] = length(at)
  const out: string[] = []
  for (let k = 0; k < len; k++) {
    const s = string(num(start + k * refSize, refSize))
    if (s === null) return null
    out.push(s)
  }
  return out
}

// a bplist00 of an array of strings, as plutil would write it
export function encodeStringArray(items: string[]): Uint8Array {
  const out: number[] = [...'bplist00'].map(c => c.charCodeAt(0))
  const refSize = items.length + 1 < 256 ? 1 : 2
  const int = (n: number) => (n < 256 ? [0x10, n] : n < 65536 ? [0x11, n >> 8, n & 255] : [0x12, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255])
  const head = (type: number, len: number) => (len < 15 ? [(type << 4) | len] : [(type << 4) | 0x0f, ...int(len)])
  const be = (n: number, size: number) => Array.from({ length: size }, (_, k) => Math.floor(n / 256 ** (size - 1 - k)) % 256)
  const offsets: number[] = []
  offsets.push(out.length)
  out.push(...head(0xa, items.length), ...items.flatMap((_, k) => be(k + 1, refSize)))
  for (const s of items) {
    offsets.push(out.length)
    // plain ASCII as such, anything else (accents, emoji) as UTF-16 big endian
    if (/^[\x00-\x7f]*$/.test(s)) out.push(...head(0x5, s.length), ...[...s].map(c => c.charCodeAt(0)))
    else {
      out.push(...head(0x6, s.length))
      for (let k = 0; k < s.length; k++) out.push(s.charCodeAt(k) >> 8, s.charCodeAt(k) & 255)
    }
  }
  const table = out.length
  const offSize = table < 256 ? 1 : table < 65536 ? 2 : 4
  for (const o of offsets) out.push(...be(o, offSize))
  out.push(0, 0, 0, 0, 0, 0, offSize, refSize, ...be(offsets.length, 8), ...be(0, 8), ...be(table, 8))
  return Uint8Array.from(out)
}

export const decodeTags = (buf: Uint8Array): Tag[] => (decodeStringArray(buf) ?? []).map(parseTag)
export const encodeTags = (tags: Tag[]): Uint8Array => encodeStringArray(tags.map(formatTag))
