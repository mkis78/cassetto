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
