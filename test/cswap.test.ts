import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { parseCswapList } from '../src/main/cswap'

const fixture = readFileSync(join(__dirname, 'fixtures/cswap-list.txt'), 'utf8')

test('parses accounts with usage from cswap 0.26 list output', () => {
  const a = parseCswapList(fixture)
  expect(a).toHaveLength(2)
  expect(a[0]).toEqual({ slot: 1, email: 'a@example.com', label: 'Acme', active: true, usage5h: 14, usage7d: 4 })
  expect(a[1].active).toBe(false)
  expect(a[1].usage5h).toBe(0)
  expect(a[1].usage7d).toBe(25)
})

test('parses accounts with usage from cswap 0.29 list output', () => {
  const a = parseCswapList(readFileSync(join(__dirname, 'fixtures/cswap-list-0.29.txt'), 'utf8'))
  expect(a).toHaveLength(2)
  expect(a[0]).toEqual({ slot: 1, email: 'a@example.com', label: 'Acme', active: true, usage5h: 14, usage7d: 4 })
  expect(a[1].email).toBe('team@example.com')
  expect(a[1].active).toBe(false)
  expect(a[1].usage5h).toBe(0)
  expect(a[1].usage7d).toBe(25)
})

test('empty output yields no accounts', () => expect(parseCswapList('')).toEqual([]))

test('missing cswap resolves with an error instead of throwing', async () => {
  const { listAccounts } = await import('../src/main/cswap')
  const r = await listAccounts('/nonexistent')
  expect(r.accounts).toEqual([])
  expect(r.error).toMatch(/cswap non disponibile/)
  expect(listAccounts('/nonexistent')).toBe(listAccounts('/other')) // one list shared within 10 s
})
