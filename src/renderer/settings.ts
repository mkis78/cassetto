import { useSyncExternalStore } from 'react'
import type { Settings } from '../shared/types'

export const DEFAULT_SETTINGS: Settings = { theme: 'system' }

// The settings in effect, outside React too
let current = DEFAULT_SETTINGS
const subs = new Set<() => void>()

const prefersLight = window.matchMedia('(prefers-color-scheme: light)')
export const resolvedTheme = (): 'dark' | 'light' => (current.theme === 'system' ? (prefersLight.matches ? 'light' : 'dark') : current.theme)

export function applySettings(s: Partial<Settings> | undefined): void {
  const next = { ...DEFAULT_SETTINGS, ...s }
  if (JSON.stringify(next) === JSON.stringify(current) && document.documentElement.dataset.theme) return
  current = next
  document.documentElement.dataset.theme = resolvedTheme() // styles.css swaps its colour variables on this
  subs.forEach(f => f())
}
// "Sistema" follows macOS / the desktop when it switches between light and dark
prefersLight.addEventListener('change', () => current.theme === 'system' && ((document.documentElement.dataset.theme = resolvedTheme()), subs.forEach(f => f())))

export const getSettings = () => current
export const onSettings = (f: () => void) => (subs.add(f), () => void subs.delete(f))
// re-render on a theme change, also one that comes from the system
export const useTheme = () => useSyncExternalStore(onSettings, resolvedTheme)
