import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { resolveLang, setLang, t } from '../src/shared/i18n'
import { EN } from '../src/shared/locales/en'

afterEach(() => setLang('it'))

test('Italian is the key; other languages translate it, filling the {vars}', () => {
  expect(t('{n} file', { n: 3 })).toBe('3 file')
  setLang('en')
  expect(t('Testo che nessuno ha tradotto')).toBe('Testo che nessuno ha tradotto')
  expect(t('{a} e {b}', { a: 1 })).toBe('1 e {b}') // a missing var stays visible
})

test('the system language decides unless the user chose', () => {
  expect(resolveLang('system', 'it-IT')).toBe('it')
  expect(resolveLang(undefined, 'de-DE')).toBe('en')
  expect(resolveLang('it', 'en-US')).toBe('it')
})

// every t('…') and tx('…') in the sources: plain string literals as first argument
function keys(): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (d: string) =>
    readdirSync(d).forEach(f => {
      const p = join(d, f)
      if (statSync(p).isDirectory()) return walk(p)
      if (!/\.tsx?$/.test(f) || p.includes('locales') || f === 'i18n.ts') return
      const src = readFileSync(p, 'utf8')
      for (const m of src.matchAll(/\btx?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
        if (m[1] === '`' && m[2].includes('${')) throw new Error(`${p}: t() with a template literal: use {vars} instead: ${m[2]}`)
        out.set(m[2].replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\\\/g, '\\'), p)
      }
    })
  walk(join(__dirname, '../src'))
  return out
}

test('every text has its English, and the English has the same {vars}', () => {
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',')
  const missing: string[] = []
  const wrong: string[] = []
  for (const [k, file] of keys()) {
    if (!(k in EN)) missing.push(`${file}: ${JSON.stringify(k)}`)
    else if (vars(k) !== vars(EN[k])) wrong.push(`${JSON.stringify(k)} → ${JSON.stringify(EN[k])}`)
  }
  expect(missing).toEqual([])
  expect(wrong).toEqual([])
})

test('a |context suffix tells keys apart and never shows', () => {
  expect(t('{n} file|plurale', { n: 2 })).toBe('2 file')
  setLang('en')
  expect(t('file|plurale')).toBe('files')
  expect(t('file')).toBe('file')
})
