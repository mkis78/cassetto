import type { SearchQuery } from './types'

export interface Part {
  text: string
  match: boolean
}

// The parts of a result line that the query matched, for highlighting. Mirrors the search rules
// (lower-case query ignores case); a regex JavaScript cannot read just leaves the line plain.
export function highlight(line: string, q: SearchQuery): Part[] {
  let re: RegExp
  try {
    const src = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(q.word ? `\\b(?:${src})\\b` : src, q.text === q.text.toLowerCase() ? 'gi' : 'g')
  } catch {
    return [{ text: line, match: false }]
  }
  const parts: Part[] = []
  let at = 0
  for (const m of line.matchAll(re)) {
    if (!m[0]) continue // empty matches (x*) highlight nothing
    if (m.index > at) parts.push({ text: line.slice(at, m.index), match: false })
    parts.push({ text: m[0], match: true })
    at = m.index + m[0].length
  }
  if (at < line.length || !parts.length) parts.push({ text: line.slice(at), match: false })
  return parts
}
