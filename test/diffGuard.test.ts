import { expect, test } from 'vitest'
import { DIFF_LIMIT, diffProblem } from '../src/shared/diffGuard'

test('diffProblem: binary by NUL in the first 8 KB, large over the limit, else fine', () => {
  expect(diffProblem('a\n', 'b\n')).toBeNull()
  expect(diffProblem('', 'x\0y')).toBe('binary')
  expect(diffProblem('x'.repeat(9000) + '\0', '')).toBeNull() // past the first 8 KB
  expect(diffProblem('x'.repeat(DIFF_LIMIT), '')).toBeNull()
  expect(diffProblem('', 'x'.repeat(DIFF_LIMIT + 1))).toBe('large')
  expect(diffProblem('\0', 'x'.repeat(DIFF_LIMIT + 1))).toBe('binary')
})
