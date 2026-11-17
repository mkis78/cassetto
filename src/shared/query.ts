// The search options, shared by main (the tools' flags, the last filter on hits) and the renderer (highlight, the badge).
import type { SearchQuery } from './types'

export const DEFAULT_MAX = 1000
export const MAX_CHOICES = [100, 500, 1000, 5000, 10000]

// 'smart' (the default): a lower-case query ignores case, any capital matches it exactly
export const ignoreCase = (q: Pick<SearchQuery, 'text' | 'case'>) => q.case === 'ignore' || (q.case !== 'match' && q.text === q.text.toLowerCase())

// how many hits at most: the user's choice within reason
export const maxHits = (q: SearchQuery) => Math.min(100_000, Math.max(1, Math.round(q.max ?? DEFAULT_MAX)))

// "node_modules, *.log\nbuild/" → ["node_modules", "*.log", "build"]
export const patterns = (s?: string) =>
  (s ?? '')
    .split(/[,\n]/)
    .map(p => p.trim().replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter(Boolean)

export const globToRegex = (g: string) =>
  g
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map(p => (p === '**/' ? '(?:.*/)?' : p === '**' ? '.*' : p === '*' ? '[^/]*' : p === '?' ? '[^/]' : p.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('')

// Which hit paths (relative to the searched folder) the include and exclude lists let through.
// A pattern without "/" is a name: it matches any file or folder on the way (node_modules, *.log);
// one with "/" is a path from the searched folder, and covers what is inside it (src/gen, docs/*.md).
// Case is ignored: a Mac disk does not tell them apart, and a list typed by hand should not have to.
export function pathFilter(q: Pick<SearchQuery, 'include' | 'exclude'>): (path: string) => boolean {
  const named = (p: string) => new RegExp(`^${globToRegex(p)}$`, 'i')
  const under = (p: string) => new RegExp(`^${globToRegex(p)}(?:/.*)?$`, 'i')
  const inc = patterns(q.include).map(p => (p.includes('/') ? (path: string) => under(p).test(path) : (path: string) => named(p).test(path.slice(path.lastIndexOf('/') + 1))))
  const exc = patterns(q.exclude).map(p => (p.includes('/') ? (path: string) => under(p).test(path) : (path: string) => path.split('/').some(s => named(p).test(s))))
  return path => (!inc.length || inc.some(f => f(path))) && !exc.some(f => f(path))
}

// the options set away from their defaults, for the badge on the Opzioni button
export const changedOptions = (q: SearchQuery) =>
  [q.mode !== 'tag' && q.case && q.case !== 'smart', q.mode === 'content' && q.regex, q.mode === 'content' && q.word, q.subfolders === false, patterns(q.include).length > 0, patterns(q.exclude).length > 0, (q.max ?? DEFAULT_MAX) !== DEFAULT_MAX].filter(Boolean).length
