import { expect, test } from 'vitest'
import { realpathSync } from 'node:fs'
import { parseLsofCwd, procCwd } from '../src/main/platform/procCwd'

test('the folder is the n line of lsof -Fn', () => {
  expect(parseLsofCwd('p123\nfcwd\nn/Users/me/a folder\n')).toBe('/Users/me/a folder')
  expect(parseLsofCwd('')).toBeNull()
})

test('a live process reports its current folder', async () => {
  expect(await procCwd(process.pid)).toBe(realpathSync(process.cwd()))
})

test('an unknown process has no folder', async () => {
  expect(await procCwd(2 ** 30)).toBeNull()
})
