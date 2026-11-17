import { execFileSync } from 'node:child_process'
import { expect, test } from 'vitest'
import { decodeStringArray, decodeTags, encodeStringArray, encodeTags, parseTag } from '../src/shared/tags'

const hex = (h: string) => Uint8Array.from(h.trim().split(/\s+/).map(x => parseInt(x, 16)))
// what the Finder wrote for "Rosso" and "Lavoro" (xattr -px)
const FINDER = hex(`62 70 6C 69 73 74 30 30 A2 01 02 57 52 6F 73 73 6F 0A 36 58 4C 61 76 6F 72 6F 0A 30 08 0B 13 00
00 00 00 00 00 01 01 00 00 00 00 00 00 00 03 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 1C`)

test("reads the Finder's own bytes", () => {
  expect(decodeTags(FINDER)).toEqual([{ name: 'Rosso', color: 6 }, { name: 'Lavoro', color: 0 }])
})

test('writes what it reads back, ASCII and not, short and long', () => {
  for (const items of [[], ['a\n1'], ['Città\n2', '😀 emoji\n0'], Array.from({ length: 300 }, (_, i) => `tag numero ${i} con un nome lungo\n${i % 8}`)]) {
    expect(decodeStringArray(encodeStringArray(items))).toEqual(items)
  }
  expect(encodeTags([{ name: 'Rosso', color: 6 }, { name: 'Lavoro', color: 0 }])).toEqual(FINDER) // byte for byte as the Finder
})

test.skipIf(process.platform !== 'darwin')('plutil reads what it writes', () => {
  const items = ['Città\n2', 'x'.repeat(20) + '\n4', 'Lavoro\n0']
  const json = execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: Buffer.from(encodeStringArray(items)) }).toString()
  expect(JSON.parse(json)).toEqual(items)
})

test('garbage is no tags, a tag without colour has none', () => {
  expect(decodeTags(Uint8Array.from([1, 2, 3]))).toEqual([])
  expect(parseTag('Solo nome')).toEqual({ name: 'Solo nome', color: 0 })
  expect(parseTag('Strano\n9')).toEqual({ name: 'Strano\n9', color: 0 })
})
