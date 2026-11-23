// File references in a line of terminal output, as Claude, compilers and test runners print them:
// "src/app.ts", "./a.ts:42", "/abs/x.py:3:7", "(lib/y.go:10)". Only names with an extension count,
// so plain words never look like files; whether the file exists is checked by the caller.
const PATH = /(?:~|\.{1,2})?\/?(?:[\w.@+-]+\/)*[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,12}(?::(\d+)(?::\d+)?)?/g

export interface PathRef {
  start: number // index in the line
  text: string // as printed, line number included
  path: string
  line?: number
}

export function findPaths(line: string): PathRef[] {
  const out: PathRef[] = []
  for (const m of line.matchAll(PATH)) {
    const before = line.slice(0, m.index)
    if (/[\w.:/@-]$/.test(before)) continue // the middle of a longer token
    if (/:\/\/[^\s]*$/.test(before + m[0].split('/')[0])) continue // part of a URL
    const text = m[0].replace(/[.:]+$/, '') // a sentence's full stop is not part of the name
    const path = text.replace(/:\d+(?::\d+)?$/, '')
    if (/^v?\d+(\.\d+)+$/.test(path)) continue // a version number, 1.2.3 or v1.2.3
    out.push({ start: m.index, text, path, ...(m[1] ? { line: Number(m[1]) } : {}) })
  }
  return out
}

// a printed path as an absolute one, against the terminal's folder; "~/" needs the home (null: not known, on a server)
export function resolvePath(cwd: string, path: string, home: string | null): string | null {
  if (path.startsWith('~/') && !home) return null
  const full = path.startsWith('/') ? path : path.startsWith('~/') ? home + path.slice(1) : `${cwd}/${path}`
  const out: string[] = []
  for (const s of full.split('/')) {
    if (s === '..') out.pop()
    else if (s && s !== '.') out.push(s)
  }
  return '/' + out.join('/')
}
