import { expect, test } from 'vitest'
import { common, parseAppLists, parseDesktopEntry, parseGioMime } from '../src/main/platform/openWith'

test('parseGioMime keeps names with spaces', () => {
  const out = 'Default application for “text/plain”: org.gnome.TextEditor.desktop\nRegistered applications:\n\torg.gnome.TextEditor.desktop\n\tMy Editor.desktop\nRecommended applications:\n\torg.gnome.TextEditor.desktop\n'
  expect(parseGioMime(out)).toEqual({ default: 'org.gnome.TextEditor.desktop', apps: ['org.gnome.TextEditor.desktop', 'My Editor.desktop'] })
})

test('parseGioMime without a default', () => {
  expect(parseGioMime('No default applications for “x/y”\nRegistered applications:\n\ta.desktop\n')).toEqual({ default: null, apps: ['a.desktop'] })
})

test('parseDesktopEntry reads the main group only', () => {
  const text = '[Desktop Entry]\nName=Editor\nNoDisplay=true\n[Desktop Action new]\nName=New window\n'
  expect(parseDesktopEntry(text)).toEqual({ name: 'Editor', noDisplay: true })
  expect(parseDesktopEntry('[Desktop Action x]\nName=No\n')).toBeNull()
  expect(parseDesktopEntry('[Desktop Entry]\nName=Viewer\n')?.noDisplay).toBe(false)
})

test('app lists per file, common ones only, default first', () => {
  const lists = parseAppLists('/A.app\n/B.app\n/C.app\n\n/B.app\n/A.app\n\n')
  expect(lists).toEqual([['/A.app', '/B.app', '/C.app'], ['/B.app', '/A.app']])
  expect(common(lists)).toEqual(['/A.app', '/B.app'])
  expect(common([])).toEqual([])
})
