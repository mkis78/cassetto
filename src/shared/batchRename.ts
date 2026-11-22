// Pure rules of the batch rename, shared by main (re-check) and renderer (preview).
import { t } from './i18n'
import { nameError } from './fileOps'

export type RenameRule =
  | { kind: 'replace'; find: string; with: string; caseSensitive: boolean }
  | { kind: 'add'; text: string; where: 'before' | 'after' }
  | { kind: 'format'; base: string; where: 'before' | 'after'; start: number; digits: number }
  | { kind: 'case'; to: 'lower' | 'upper' | 'title' }

// 'a.tar.gz' → ['a.tar', '.gz']; a dotfile has no extension
export function splitExt(name: string): [stem: string, ext: string] {
  const i = name.lastIndexOf('.')
  return i > 0 ? [name.slice(0, i), name.slice(i)] : [name, '']
}

function apply(s: string, rule: RenameRule, i: number): string {
  switch (rule.kind) {
    case 'replace': {
      if (!rule.find) return s
      const re = new RegExp(rule.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), rule.caseSensitive ? 'g' : 'gi')
      return s.replace(re, () => rule.with) // function replacer: `with` stays verbatim ($& etc.)
    }
    case 'add': return rule.where === 'before' ? rule.text + s : s + rule.text
    case 'format': {
      const num = String(rule.start + i).padStart(rule.digits, '0')
      const sep = rule.base ? ' ' : ''
      return rule.where === 'after' ? `${rule.base}${sep}${num}` : `${num}${sep}${rule.base}`
    }
    case 'case':
      if (rule.to === 'lower') return s.toLowerCase()
      if (rule.to === 'upper') return s.toUpperCase()
      return s.toLowerCase().replace(/(^|[ _-])([^ _-])/g, (_, a, b) => a + b.toUpperCase())
  }
}

export function renamed(names: string[], rule: RenameRule, includeExt: boolean): string[] {
  return names.map((n, i) => {
    if (includeExt) return apply(n, rule, i)
    const [stem, ext] = splitExt(n)
    return apply(stem, rule, i) + ext
  })
}

// per item: why it cannot go ahead, or null; `fold` folds names the way the file system compares them
export function conflicts(pairs: { from: string; to: string }[], existing: string[], fold: (s: string) => string): (string | null)[] {
  const count = new Map<string, number>()
  for (const p of pairs) count.set(fold(p.to), (count.get(fold(p.to)) ?? 0) + 1)
  const ex = new Set(existing.map(fold))
  const moving = new Set(pairs.map(p => fold(p.from)))
  return pairs.map(p => {
    if (p.to === p.from) return null
    const k = fold(p.to)
    return nameError(p.to, new Set())
      ?? (new TextEncoder().encode(p.to).length > 255 ? t('Nome troppo lungo') : null) // the usual file-system limit, in bytes
      ?? (count.get(k)! > 1 ? t('Nome doppio') : ex.has(k) && !moving.has(k) ? t('Esiste già') : null)
  })
}
