// Fuzzy matching for quick open and the command palette: the query's characters in order, not necessarily
// together ("gtt" finds "GitTile.tsx"). Ranked so that runs of characters, word starts and the file name win.
export interface Match {
  score: number
  at: number[] // the matched characters, to highlight them
}

const boundary = (s: string, i: number) => i === 0 || /[/\\._\-\s]/.test(s[i - 1]) || (/[a-z]/.test(s[i - 1]) && /[A-Z]/.test(s[i]))

export function fuzzy(query: string, text: string): Match | null {
  const q = query.replace(/\s+/g, '').toLowerCase()
  if (!q) return { score: 0, at: [] }
  const t = text.toLowerCase()
  const base = text.lastIndexOf('/') + 1
  // greedy from the right end of the text would favour the file name; from the left is simpler and good enough
  // ponytail: one left-to-right pass, not the best alignment; a DP if rankings ever look wrong
  const at: number[] = []
  let score = 0
  let i = 0
  for (const c of q) {
    const j = t.indexOf(c, i)
    if (j < 0) return null
    score += 1 + (boundary(text, j) ? 4 : 0) + (at.length && at[at.length - 1] === j - 1 ? 3 : 0) + (j >= base ? 2 : 0)
    at.push(j)
    i = j + 1
  }
  return { score: score - text.length * 0.01, at } // shorter wins a tie
}

// the best `max` of `items` for `query`, best first
export function rank<T>(query: string, items: T[], key: (t: T) => string, max = 50): { item: T; match: Match }[] {
  const out: { item: T; match: Match }[] = []
  for (const item of items) {
    const match = fuzzy(query, key(item))
    if (match) out.push({ item, match })
  }
  return out.sort((a, b) => b.match.score - a.match.score).slice(0, max)
}
