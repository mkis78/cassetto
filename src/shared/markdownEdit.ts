// Markdown formatting in the editor, on plain strings so it tests without CodeMirror.

// **x**, *x*, `x`: on, or off when the text already has it
export function toggleWrap(text: string, marker: string): string {
  const n = marker.length
  return text.length >= 2 * n && text.startsWith(marker) && text.endsWith(marker) ? text.slice(n, -n) : marker + text + marker
}

export type LineKind = 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'task' | 'quote'
const PREFIX = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)?/

// what a line starts with, as one of the kinds (null: plain text)
function kindOf(line: string): LineKind | null {
  const p = PREFIX.exec(line)![2] ?? ''
  if (/^#\s/.test(p)) return 'h1'
  if (/^##\s/.test(p)) return 'h2'
  if (/^###\s/.test(p)) return 'h3'
  if (/\[[ xX]\]/.test(p)) return 'task'
  if (/^[-*+]/.test(p)) return 'ul'
  if (/^\d/.test(p)) return 'ol'
  if (p.startsWith('>')) return 'quote'
  return null
}

// The lines become `kind` (any heading, list or quote marker they had replaced), or plain text again when
// they all were that kind already. Blank lines stay blank; numbered lists count from 1.
export function toggleLines(lines: string[], kind: LineKind): string[] {
  const filled = lines.filter(l => l.trim())
  const off = filled.length > 0 && filled.every(l => kindOf(l) === kind)
  let n = 0
  return lines.map(l => {
    if (!l.trim()) return l
    const [, indent, old = ''] = PREFIX.exec(l)!
    const body = l.slice(indent.length + old.length)
    if (off) return indent + body
    const mark = { h1: '# ', h2: '## ', h3: '### ', ul: '- ', ol: `${++n}. `, task: '- [ ] ', quote: '> ' }[kind]
    return indent + mark + body
  })
}

// "- [ ] x" ⇄ "- [x] x"; other lines as they are
export const toggleTask = (line: string): string => line.replace(/^(\s*[-*+]\s+\[)([ xX])(\])/, (_, a: string, c: string, b: string) => a + (c === ' ' ? 'x' : ' ') + b)

export const TABLE = '| Colonna 1 | Colonna 2 |\n| --- | --- |\n|  |  |\n'
