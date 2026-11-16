// Editor commands in the manner of Sublime Text, on top of CodeMirror's own.
import { EditorSelection, type EditorState, type StateCommand as Command } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { joinLines, sortLines, titleCase, trimTrailing } from '../shared/textOps'
import { TABLE, toggleLines, toggleTask, toggleWrap, type LineKind } from '../shared/markdownEdit'

// the whole lines a range touches
const linesOf = (state: EditorState, from: number, to: number) => ({ from: state.doc.lineAt(from).from, to: state.doc.lineAt(to).to })

// `fn` on the lines each selection covers; with nothing selected: the whole file (sort) or this line and the next (join)
const onLines =
  (fn: (text: string) => string, empty: 'all' | 'next'): Command =>
  ({ state, dispatch }) => {
    dispatch(
      state.update(
        state.changeByRange(r => {
          const span =
            !r.empty ? linesOf(state, r.from, r.to) : empty === 'all' ? { from: 0, to: state.doc.length } : linesOf(state, r.head, Math.min(state.doc.lineAt(r.head).to + 1, state.doc.length))
          const insert = fn(state.sliceDoc(span.from, span.to))
          return { changes: { ...span, insert }, range: r.empty && empty === 'next' ? EditorSelection.cursor(span.from + state.doc.lineAt(r.head).length) : EditorSelection.range(span.from, span.from + insert.length) }
        }),
        { scrollIntoView: true, userEvent: 'input' }
      )
    )
    return true
  }

export const sortSelectedLines = onLines(sortLines, 'all')
export const joinSelectedLines = onLines(joinLines, 'next')

// `fn` on each selection; a bare cursor takes the word it is on, like Sublime
const onWords =
  (fn: (text: string) => string): Command =>
  ({ state, dispatch }) => {
    dispatch(
      state.update(
        state.changeByRange(r => {
          const span = r.empty ? (state.wordAt(r.head) ?? r) : r
          const insert = fn(state.sliceDoc(span.from, span.to))
          return { changes: { from: span.from, to: span.to, insert }, range: EditorSelection.range(span.from, span.from + insert.length) }
        }),
        { userEvent: 'input' }
      )
    )
    return true
  }

export const upperCase = onWords(t => t.toUpperCase())
export const lowerCase = onWords(t => t.toLowerCase())
export const titleCaseWords = onWords(titleCase)

export const trimTrailingSpaces: Command = ({ state, dispatch }) => {
  const text = state.doc.toString()
  const trimmed = trimTrailing(text)
  if (trimmed === text) return false
  // line by line, so the cursors stay where they were
  const changes = []
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i)
    const m = /[ \t]+$/.exec(line.text)
    if (m) changes.push({ from: line.to - m[0].length, to: line.to })
  }
  dispatch(state.update({ changes, userEvent: 'delete' }))
  return true
}

// Cmd+Shift+L: one cursor per line of the selection, each keeping its part of it
export const splitSelectionByLine: Command = ({ state, dispatch }) => {
  const ranges = state.selection.ranges.flatMap(r => {
    if (r.empty) return [r]
    const out = []
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      const line = state.doc.line(n)
      out.push(EditorSelection.range(Math.max(line.from, r.from), Math.min(line.to, r.to)))
    }
    return out
  })
  if (ranges.length === state.selection.ranges.length) return false
  dispatch(state.update({ selection: EditorSelection.create(ranges, ranges.length - 1) }))
  return true
}

// Cmd+Shift+Enter: a new line above, indented like this one
export const insertLineAbove: Command = ({ state, dispatch }) => {
  dispatch(
    state.update(
      state.changeByRange(r => {
        const line = state.doc.lineAt(r.head)
        const indent = /^\s*/.exec(line.text)![0]
        return { changes: { from: line.from, insert: indent + '\n' }, range: EditorSelection.cursor(line.from + indent.length) }
      }),
      { scrollIntoView: true, userEvent: 'input' }
    )
  )
  return true
}

export interface Sym {
  name: string
  kind: string // as shown: funzione, classe…
  from: number
  line: number
}

const KIND: [RegExp, string][] = [
  [/^Method|MethodDeclaration|MethodDefinition/, 'metodo'],
  [/Function|Arrow/, 'funzione'],
  [/Class|Struct|Impl|Trait/, 'classe'],
  [/Interface|TypeAlias|Type|Enum/, 'tipo']
]
const DECL = /(Function|Class|Method|Interface|TypeAlias|Enum|Struct|Trait|Impl)(Declaration|Definition|Item|Decl|Spec)$/
const NAME = ['VariableDefinition', 'PropertyDefinition', 'TypeDefinition', 'VariableName', 'BoundIdentifier', 'TypeIdentifier', 'Definition', 'Identifier', 'Name', 'PropertyName']

// Cmd+R: the functions, classes, types and Markdown headings of the file, from its syntax tree (any language
// CodeMirror parses with Lezer; legacy modes have no tree, so no symbols)
export function symbols(state: EditorState): Sym[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 300) ?? syntaxTree(state)
  const out: Sym[] = []
  tree.iterate({
    enter: n => {
      const t = n.type.name
      const h = /^(?:ATX|Setext)Heading(\d)$/.exec(t)
      if (h) {
        const text = state.sliceDoc(n.from, n.to).split('\n')[0].replace(/^#+\s*/, '').replace(/\s*#*\s*$/, '')
        out.push({ name: `${'  '.repeat(Number(h[1]) - 1)}${text}`, kind: `titolo ${h[1]}`, from: n.from, line: state.doc.lineAt(n.from).number })
        return false
      }
      if (!DECL.test(t)) return
      let name = null
      for (let c = n.node.firstChild; c && !name; c = c.nextSibling) if (NAME.includes(c.type.name)) name = state.sliceDoc(c.from, c.to)
      if (name) out.push({ name, kind: KIND.find(([re]) => re.test(t))?.[1] ?? 'simbolo', from: n.from, line: state.doc.lineAt(n.from).number })
    }
  })
  return out
}

// Markdown

// **bold**, *italic*, `code` on each selection; a bare cursor takes its word, or gets the markers to type in between
export const mdWrap =
  (marker: string): Command =>
  ({ state, dispatch }) => {
    dispatch(
      state.update(
        state.changeByRange(r => {
          const span = r.empty ? (state.wordAt(r.head) ?? r) : r
          const text = state.sliceDoc(span.from, span.to)
          // the markers may sit just outside the selection: take them off from there too
          const outside = state.sliceDoc(span.from - marker.length, span.from) === marker && state.sliceDoc(span.to, span.to + marker.length) === marker
          if (outside) return { changes: [{ from: span.from - marker.length, to: span.from }, { from: span.to, to: span.to + marker.length }], range: EditorSelection.range(span.from - marker.length, span.to - marker.length) }
          const insert = toggleWrap(text, marker)
          if (!text) return { changes: { from: span.from, insert }, range: EditorSelection.cursor(span.from + marker.length) }
          return { changes: { from: span.from, to: span.to, insert }, range: EditorSelection.range(span.from, span.from + insert.length) }
        }),
        { userEvent: 'input' }
      )
    )
    return true
  }

// `fn` on the whole lines of each selection
const mdOnLines =
  (fn: (lines: string[]) => string[]): Command =>
  ({ state, dispatch }) => {
    dispatch(
      state.update(
        state.changeByRange(r => {
          const span = linesOf(state, r.from, r.to)
          const insert = fn(state.sliceDoc(span.from, span.to).split('\n')).join('\n')
          return { changes: { ...span, insert }, range: r.empty ? EditorSelection.cursor(span.from + insert.split('\n')[0].length) : EditorSelection.range(span.from, span.from + insert.length) }
        }),
        { userEvent: 'input' }
      )
    )
    return true
  }

export const mdLines = (kind: LineKind) => mdOnLines(lines => toggleLines(lines, kind))
export const mdTask = mdOnLines(lines => lines.map(toggleTask))

// [selection](url), with "url" selected to type over
export const mdLink: Command = ({ state, dispatch }) => {
  dispatch(
    state.update(
      state.changeByRange(r => {
        const text = state.sliceDoc(r.from, r.to) || 'testo'
        const insert = `[${text}](url)`
        const at = r.from + text.length + 3
        return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.range(at, at + 3) }
      }),
      { userEvent: 'input' }
    )
  )
  return true
}

// the selected lines inside ``` fences, the cursor where the language goes
export const mdCodeBlock: Command = ({ state, dispatch }) => {
  dispatch(
    state.update(
      state.changeByRange(r => {
        const span = linesOf(state, r.from, r.to)
        const body = state.sliceDoc(span.from, span.to)
        return { changes: { ...span, insert: '```\n' + body + '\n```' }, range: EditorSelection.cursor(span.from + 3) }
      }),
      { userEvent: 'input' }
    )
  )
  return true
}

export const mdTable: Command = ({ state, dispatch }) => {
  const line = state.doc.lineAt(state.selection.main.head)
  const at = line.text.trim() ? line.to : line.from
  const insert = (line.text.trim() ? '\n\n' : '') + TABLE
  dispatch(state.update({ changes: { from: at, insert }, selection: EditorSelection.cursor(at + insert.indexOf('Colonna 1')), userEvent: 'input' }))
  return true
}
