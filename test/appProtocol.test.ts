import { expect, test } from 'vitest'
import { appFile } from '../src/main/appProtocol'

const root = '/App/out/renderer'

test('our files, query and fragment ignored', () => {
  expect(appFile(root, 'app://cassetto/index.html')).toBe('/App/out/renderer/index.html')
  expect(appFile(root, 'app://cassetto/assets/EditorTile-x.js?v=1#a')).toBe('/App/out/renderer/assets/EditorTile-x.js')
  expect(appFile(root, 'app://cassetto/a%20b.svg')).toBe('/App/out/renderer/a b.svg')
})

test('nothing outside the folder, nor from another host or scheme', () => {
  expect(appFile(root, 'app://cassetto/../../etc/passwd')).toBe('/App/out/renderer/etc/passwd') // the URL parser already drops the ..
  expect(appFile(root, 'app://cassetto/%2e%2e/%2e%2e/etc/passwd')).toBe('/App/out/renderer/etc/passwd') // %2e%2e is a .. to the parser too
  expect(appFile(root, 'app://cassetto/..%2f..%2f..%2fetc/passwd')).toBeNull() // decoded only after it: caught here
  expect(appFile(root, 'app://cassetto/..%2f..%2fetc/passwd')).toBeNull()
  expect(appFile(root, 'app://cassetto/')).toBeNull() // the folder itself
  expect(appFile(root, 'app://altro/index.html')).toBeNull()
  expect(appFile(root, 'file:///etc/passwd')).toBeNull()
  expect(appFile(root, 'app://cassetto/%E0%A4%A')).toBeNull()
  expect(appFile(root, 'app://cassetto/a%00.js')).toBeNull()
})
