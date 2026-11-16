import { expect, test } from 'vitest'
import { fromEvent, shortcutLabel, systemConflict } from '../src/shared/shortcuts'

const ev = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean } = {}) => ({ code, ctrlKey: !!mods.ctrl, altKey: !!mods.alt, shiftKey: !!mods.shift, metaKey: !!mods.meta })

test('a key press becomes an accelerator, modifiers in a fixed order', () => {
  expect(fromEvent(ev('Space', { ctrl: true }))).toBe('Ctrl+Space')
  expect(fromEvent(ev('KeyK', { meta: true, shift: true, alt: true }))).toBe('Alt+Shift+Cmd+K')
  expect(fromEvent(ev('Digit3', { ctrl: true }))).toBe('Ctrl+3')
  expect(fromEvent(ev('ArrowUp', { alt: true }))).toBe('Alt+Up')
})

test('no shortcut without Ctrl, Alt or Cmd, nor from a lone modifier or an unknown key', () => {
  expect(fromEvent(ev('KeyA', { shift: true }))).toBeNull()
  expect(fromEvent(ev('Space'))).toBeNull()
  expect(fromEvent(ev('ControlLeft', { ctrl: true }))).toBeNull()
  expect(fromEvent(ev('F5', { ctrl: true }))).toBeNull()
})

test('label', () => expect(shortcutLabel('Alt+Space')).toBe('Opzione+Spazio'))

test('Ctrl+Space clashes with the input source switch on a fresh Mac, not once it is turned off', () => {
  expect(systemConflict('Ctrl+Space', {})).toBe('Seleziona la sorgente di input precedente')
  expect(systemConflict('Ctrl+Space', { '60': { enabled: false, value: { parameters: [32, 49, 262144] } } })).toBeNull()
  expect(systemConflict('Ctrl+Space', { '60': { enabled: 0 } })).toBeNull()
  expect(systemConflict('Alt+Space', {})).toBeNull()
})

test('a shortcut moved elsewhere in the preferences clashes where it now is', () => {
  const moved = { '60': { enabled: true, value: { parameters: [107, 40, 262144] } } } // Ctrl+K
  expect(systemConflict('Ctrl+Space', moved)).toBeNull()
  expect(systemConflict('Ctrl+K', moved)).toBe('Seleziona la sorgente di input precedente')
})

test('screenshots: Shift+Cmd+3 with extra system bits in the flags; unknown ids get a generic name', () => {
  const hk = { '28': { enabled: true, value: { parameters: [51, 20, 1179648] } }, '999': { enabled: true, value: { parameters: [65535, 46, 1572864] } } }
  expect(systemConflict('Shift+Cmd+3', hk)).toBe("Salva un'istantanea dello schermo come file")
  expect(systemConflict('Alt+Cmd+M', hk)).toBe('una scorciatoia di sistema')
})

test("Raycast's hotkey", () => {
  const off = { '64': { enabled: false } }
  expect(systemConflict('Cmd+Space', off, 'Command-49')).toBe('Raycast')
  expect(systemConflict('Alt+Space', off, 'Option-49')).toBe('Raycast')
  expect(systemConflict('Ctrl+Space', { '60': { enabled: false } }, 'Command-49')).toBeNull()
})
