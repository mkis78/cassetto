// Keyboard moves in a list of `n` rows with row `at` selected (-1: none): the row to select next, null for other keys.
export function listKey(key: string, at: number, n: number, page = 10): number | null {
  if (!n) return null
  if (key === 'ArrowDown') return Math.min(at + 1, n - 1)
  if (key === 'ArrowUp') return at < 0 ? n - 1 : Math.max(at - 1, 0)
  if (key === 'PageDown') return Math.min(Math.max(at, 0) + page, n - 1)
  if (key === 'PageUp') return Math.max(at - page, 0)
  if (key === 'Home') return 0
  if (key === 'End') return n - 1
  return null
}

// type-ahead: the next name after `from` (wrapping around) that starts with `c`; `from` itself when none does
export function typeAhead(names: string[], from: number, c: string): number {
  const n = names.length
  for (let j = 1; j <= n; j++) {
    const i = (from + j + n) % n
    if (names[i].toLowerCase().startsWith(c.toLowerCase())) return i
  }
  return from
}

// A long list drawn in part: of `n` entries, `perRow` to a row, rows `pitch` apart (a row `item` big, the rest is gap), entry 0 at `start`,
// scrolled to `pos` in a box `size` big: the entries worth drawing (from, to), a screen either side, and the blank space before and after them.
export function windowOf(n: number, m: { start: number; pitch: number; item: number; perRow: number }, pos: number, size: number) {
  const first = Math.max(0, (pos - m.start) / m.pitch)
  const rows = Math.ceil(n / m.perRow)
  const fromRow = Math.max(0, Math.floor(first - size / m.pitch))
  const toRow = Math.min(rows, Math.ceil(first + (2 * size) / m.pitch) + 1)
  const gap = m.pitch - m.item
  return {
    from: fromRow * m.perRow,
    to: Math.min(n, toRow * m.perRow),
    before: fromRow ? fromRow * m.pitch - gap : 0,
    after: rows > toRow ? (rows - toRow) * m.pitch - gap : 0
  }
}
