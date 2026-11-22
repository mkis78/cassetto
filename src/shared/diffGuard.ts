export const DIFF_LIMIT = 5 * 1024 * 1024

// why two sides can't be shown as a diff: a NUL in the first 8 KB means binary, a side over the limit is too big
export function diffProblem(...sides: string[]): 'binary' | 'large' | null {
  if (sides.some(s => s.slice(0, 8192).includes('\0'))) return 'binary'
  return sides.some(s => s.length > DIFF_LIMIT) ? 'large' : null
}
