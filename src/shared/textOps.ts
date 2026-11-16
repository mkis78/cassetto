// Text transformations of the editor, on plain strings: lines in, lines out, so they test without CodeMirror.

// F5 (Sublime's "Sort Lines"): case-insensitive, natural order (file2 before file10), stable
export const sortLines = (text: string): string =>
  text
    .split('\n')
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
    .join('\n')

// Cmd+J: the lines become one, the indentation of the joined ones dropped, a single space between them
export const joinLines = (text: string): string =>
  text
    .split('\n')
    .map((l, i) => (i ? l.trim() : l.trimEnd()))
    .filter((l, i) => i === 0 || l)
    .join(' ')

export const trimTrailing = (text: string): string => text.replace(/[ \t]+$/gm, '')

// "ciao mondo" → "Ciao Mondo"
export const titleCase = (text: string): string => text.toLowerCase().replace(/(^|[\s_\-./])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase())

// How a file indents, from its lines: tabs when most indented lines start with one, else the most common step of spaces.
// null when nothing is indented (then the editor's default stays).
export function detectIndent(text: string): { tabs: boolean; size: number } | null {
  let tabs = 0
  let spaces = 0
  const steps = new Map<number, number>()
  let prev = 0
  for (const line of text.split('\n').slice(0, 2000)) {
    if (!line.trim()) continue
    if (line.startsWith('\t')) {
      tabs++
      continue
    }
    const n = line.length - line.trimStart().length
    if (n) spaces++
    const step = Math.abs(n - prev)
    if (step >= 2 && step <= 8) steps.set(step, (steps.get(step) ?? 0) + 1)
    prev = n
  }
  if (!tabs && !spaces) return null
  if (tabs > spaces) return { tabs: true, size: 4 }
  const best = [...steps].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]
  return { tabs: false, size: best?.[0] ?? 4 }
}
