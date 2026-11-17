// Pure rules behind the Files tile's operations, shared by main and renderer.
import { t } from './i18n'

// the listings that loaded, up to the first that did not: a column chain stops where a folder vanished
export function okPrefix<T>(results: ({ ok: true; listing: T } | { ok: false; error: string })[]): T[] {
  const i = results.findIndex(r => !r.ok)
  return results.slice(0, i < 0 ? results.length : i).map(r => (r as { listing: T }).listing)
}

// Finder style: "a.txt" → "a copia.txt", then "a copia 2.txt"; a dotfile or a folder gets it at the end
export function copyName(name: string, taken: { has(n: string): boolean }): string {
  const dot = name.lastIndexOf('.')
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let n = 1; ; n++) {
    const c = (n > 1 ? t('{name} copia {n}', { name: stem, n }) : t('{name} copia', { name: stem })) + ext
    if (!taken.has(c)) return c
  }
}

// is `dest` the folder `src` itself or somewhere below it
export const isInside = (src: string, dest: string): boolean => dest === src || dest.startsWith(src.replace(/\/$/, '') + '/')

// why `name` cannot be used in a folder holding `taken`, or null
export function nameError(name: string, taken: Set<string>): string | null {
  if (!name.trim()) return t('Nome vuoto')
  if (/[/\0]/.test(name) || name === '.' || name === '..') return t('Nome non valido')
  return taken.has(name) ? t('Esiste già') : null
}

// the names from `anchor` to `target`, in list order; without the anchor, just the target
export function rangeSelect(names: string[], anchor: string, target: string): string[] {
  const a = names.indexOf(anchor)
  const b = names.indexOf(target)
  if (a < 0) return b < 0 ? [] : [target]
  return names.slice(Math.min(a, b), Math.max(a, b) + 1)
}
