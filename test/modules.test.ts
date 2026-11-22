import { expect, test } from 'vitest'

// settings.ts reads the window at load
Object.assign(globalThis, { window: { matchMedia: () => ({ matches: false, addEventListener() {} }) } })
const { MODULES, moduleOn } = await import('../src/renderer/modules')

test('compartments are off until switched on', () => {
  expect(moduleOn({ theme: 'system' }, 'git')).toBe(false)
  expect(moduleOn({ theme: 'system', modules: { git: true } }, 'git')).toBe(true)
  expect(MODULES.map(m => m.id)).toContain('git')
})
