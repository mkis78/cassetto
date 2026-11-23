import { expect, test } from 'vitest'
import { overviewOrder, type ClaudeState } from '../src/shared/claudeState'

test('overviewOrder: waiting, done, working, idle; ties keep their order', () => {
  const mk = (id: string, state: ClaudeState) => ({ id, state })
  const out = overviewOrder([mk('a', 'idle'), mk('b', 'working'), mk('c', 'done'), mk('d', 'waiting'), mk('e', 'done')])
  expect(out.map(i => i.id)).toEqual(['d', 'c', 'e', 'b', 'a'])
})
