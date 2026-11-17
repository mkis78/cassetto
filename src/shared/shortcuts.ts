// The action bar's shortcut: written as Electron accelerators ("Ctrl+Space", "Alt+Shift+K"), modifiers in a fixed order,
// so a key press and the setting compare as strings. On macOS it is checked against the system's own shortcuts.
import { t, tx } from './i18n'

export const DEFAULT_BAR = 'Ctrl+Space'

// macOS virtual key codes, as the system shortcuts store them
const KEYCODES: Record<string, number> = {
  A: 0, S: 1, D: 2, F: 3, H: 4, G: 5, Z: 6, X: 7, C: 8, V: 9, B: 11, Q: 12, W: 13, E: 14, R: 15, Y: 16, T: 17,
  '1': 18, '2': 19, '3': 20, '4': 21, '6': 22, '5': 23, '9': 25, '7': 26, '8': 28, '0': 29,
  O: 31, U: 32, I: 34, P: 35, L: 37, J: 38, K: 40, N: 45, M: 46, Space: 49, Left: 123, Right: 124, Down: 125, Up: 126
}
// in accelerator order; the flags are macOS's modifier bits
const MODS = [
  { name: 'Ctrl', flag: 262144, key: 'ctrlKey' },
  { name: 'Alt', flag: 524288, key: 'altKey' },
  { name: 'Shift', flag: 131072, key: 'shiftKey' },
  { name: 'Cmd', flag: 1048576, key: 'metaKey' }
] as const
const MOD_MASK = MODS.reduce((m, x) => m | x.flag, 0)

type KeyEvent = { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; code: string }

// the shortcut a key press makes, or null when it cannot be one: a lone modifier, a key we do not know,
// or no Ctrl/Alt/Cmd (Shift+letter is just typing)
export function fromEvent(e: KeyEvent): string | null {
  const m = /^(?:Key([A-Z])|Digit([0-9])|Arrow(Left|Right|Up|Down)|(Space))$/.exec(e.code)
  if (!m) return null
  const mods = MODS.filter(x => e[x.key])
  if (!mods.some(x => x.name !== 'Shift')) return null
  return [...mods.map(x => x.name), m[1] ?? m[2] ?? m[3] ?? m[4]].join('+')
}

// for people: "Ctrl+Spazio", "Opzione+Shift+K"
export const shortcutLabel = (s: string) => s.replace('Space', t('Spazio')).replace('Alt', t('Opzione'))

function parse(s: string): { flags: number; code: number } | null {
  const parts = s.split('+')
  const code = KEYCODES[parts.pop() ?? '']
  if (code === undefined) return null
  return { flags: parts.reduce((f, p) => f | (MODS.find(x => x.name === p)?.flag ?? 0), 0), code }
}

// what macOS calls the system shortcuts likely to clash; any other is "a system shortcut"
const NAMES: Record<string, string> = {
  '60': tx('Seleziona la sorgente di input precedente'),
  '61': tx('Seleziona la sorgente di input successiva'),
  '64': tx('Mostra la ricerca Spotlight'),
  '65': tx('Mostra la finestra di ricerca del Finder'),
  '28': tx("Salva un'istantanea dello schermo come file"),
  '29': tx("Copia un'istantanea dello schermo negli appunti"),
  '30': tx("Salva un'istantanea dell'area selezionata come file"),
  '31': tx("Copia un'istantanea dell'area selezionata negli appunti"),
  '184': tx('Opzioni istantanea e registrazione')
}
// on unless the preferences say otherwise: a fresh Mac has no entry for them
const DEFAULTS: Record<string, number[]> = { '60': [32, 49, 262144], '61': [32, 49, 786432], '64': [32, 49, 1048576], '65': [32, 49, 1572864] }

export type SymbolicHotkeys = Record<string, { enabled?: boolean | number; value?: { parameters?: number[] } }>

// the system shortcut (AppleSymbolicHotKeys from com.apple.symbolichotkeys) or Raycast's hotkey ("Command-49")
// that takes `shortcut` before Cassetto sees it; null when none does
export function systemConflict(shortcut: string, hotkeys: SymbolicHotkeys, raycast?: string | null): string | null {
  const k = parse(shortcut)
  if (!k) return null
  for (const id of new Set([...Object.keys(hotkeys), ...Object.keys(DEFAULTS)])) {
    const entry = hotkeys[id]
    const on = entry ? !!entry.enabled : true
    const p = entry?.value?.parameters ?? DEFAULTS[id]
    if (on && p && p[1] === k.code && (p[2] & MOD_MASK) === k.flags) return t(NAMES[id] ?? tx('una scorciatoia di sistema'))
  }
  const r = /^((?:\w+-)*)(\d+)$/.exec(raycast ?? '')
  if (r) {
    const names: Record<string, number> = { Control: 262144, Option: 524288, Shift: 131072, Command: 1048576 }
    const flags = r[1].split('-').reduce((f, n) => f | (names[n] ?? 0), 0)
    if (Number(r[2]) === k.code && flags === k.flags) return 'Raycast'
  }
  return null
}
