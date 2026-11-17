// Languages. The Italian text is the key: t('Nuovo file') is that text in Italian, its translation otherwise
// (or the Italian again when a translation is missing). {name} in a text is filled from `vars`.
// A key may end in |context to tell apart texts Italian writes the same ("file" and "file|plurale"): the suffix never shows.
// Never call t() at module level: the language is set once the settings are read, after the imports.
import { EN } from './locales/en'

export type Lang = 'it' | 'en'
export type LangSetting = 'system' | Lang
export const LANG_NAMES: Record<Lang, string> = { it: 'Italiano', en: 'English' }
const DICTS: Record<Lang, Record<string, string> | null> = { it: null, en: EN }

let lang: Lang = 'it'
export const setLang = (l: Lang) => void (lang = l)
export const getLang = () => lang

// "system" follows the Mac's language: Italian for Italian, English for anything else
export const resolveLang = (setting: LangSetting | undefined, systemLocale: string): Lang =>
  setting && setting !== 'system' ? setting : systemLocale.toLowerCase().startsWith('it') ? 'it' : 'en'

export function t(text: string, vars?: Record<string, string | number>): string {
  const s = DICTS[lang]?.[text] ?? text.replace(/\|[\w]+$/, '')
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s
}

// marks a text kept in a constant, to be shown later through t(variable): the completeness test finds it this way
export const tx = (text: string): string => text

// for dates and numbers in the language of the interface
export const locale = () => (lang === 'it' ? 'it-IT' : 'en-US')
