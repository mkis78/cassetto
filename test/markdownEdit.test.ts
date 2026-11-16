import { expect, test } from 'vitest'
import { toggleLines, toggleTask, toggleWrap } from '../src/shared/markdownEdit'

test('bold, italic and code go on and off', () => {
  expect(toggleWrap('ciao', '**')).toBe('**ciao**')
  expect(toggleWrap('**ciao**', '**')).toBe('ciao')
  expect(toggleWrap('`x`', '`')).toBe('x')
  expect(toggleWrap('', '**')).toBe('****') // nothing selected: the markers, to type in between
})

test('headings, lists and quotes replace each other, and toggle off', () => {
  expect(toggleLines(['Titolo'], 'h1')).toEqual(['# Titolo'])
  expect(toggleLines(['## Titolo'], 'h1')).toEqual(['# Titolo'])
  expect(toggleLines(['# Titolo'], 'h1')).toEqual(['Titolo'])
  expect(toggleLines(['a', '', 'b'], 'ol')).toEqual(['1. a', '', '2. b'])
  expect(toggleLines(['- a', '- b'], 'ol')).toEqual(['1. a', '2. b'])
  expect(toggleLines(['- a', '- b'], 'ul')).toEqual(['a', 'b'])
  expect(toggleLines(['  - [x] fatto'], 'quote')).toEqual(['  > fatto']) // indentation kept
  expect(toggleLines(['a', '- b'], 'task')).toEqual(['- [ ] a', '- [ ] b'])
})

test('tick a task', () => {
  expect(toggleTask('- [ ] pane')).toBe('- [x] pane')
  expect(toggleTask('  * [X] pane')).toBe('  * [ ] pane')
  expect(toggleTask('testo')).toBe('testo')
})
