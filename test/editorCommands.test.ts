import { expect, test } from 'vitest'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { markdown } from '@codemirror/lang-markdown'
import { insertLineAbove, joinSelectedLines, sortSelectedLines, splitSelectionByLine, symbols, trimTrailingSpaces, upperCase } from '../src/renderer/editorCommands'

// runs a command on a document with a selection, returns the document and the selection after
function run(cmd: StateCommand, doc: string, sel: { anchor: number; head?: number }[]) {
  let state = EditorState.create({ doc, selection: EditorSelection.create(sel.map(s => EditorSelection.range(s.anchor, s.head ?? s.anchor))), extensions: EditorState.allowMultipleSelections.of(true) })
  cmd({ state, dispatch: t => (state = t.state) })
  return { doc: state.doc.toString(), sel: state.selection.ranges.map(r => [r.from, r.to]) }
}

test('sort: the whole file with no selection, else the selected lines', () => {
  expect(run(sortSelectedLines, 'c\nb\na', [{ anchor: 0 }]).doc).toBe('a\nb\nc')
  expect(run(sortSelectedLines, 'z\nc\nb\na', [{ anchor: 2, head: 5 }]).doc).toBe('z\nb\nc\na')
})

test('join: this line and the next, or the selected lines', () => {
  expect(run(joinSelectedLines, 'a(\n  b\n)', [{ anchor: 0 }]).doc).toBe('a( b\n)')
  expect(run(joinSelectedLines, 'a(\n  b\n)', [{ anchor: 0, head: 8 }]).doc).toBe('a( b )')
})

test('upper case: the word under a bare cursor, or the selection', () => {
  expect(run(upperCase, 'ciao mondo', [{ anchor: 7 }]).doc).toBe('ciao MONDO')
  expect(run(upperCase, 'ciao mondo', [{ anchor: 0, head: 2 }]).doc).toBe('CIao mondo')
})

test('one cursor per selected line', () => {
  expect(run(splitSelectionByLine, 'ab\ncd\nef', [{ anchor: 1, head: 7 }]).sel).toEqual([[1, 2], [3, 5], [6, 7]])
})

test('trailing spaces go, cursors stay; a line above keeps the indentation', () => {
  expect(run(trimTrailingSpaces, 'a  \n  b \nc', [{ anchor: 0 }]).doc).toBe('a\n  b\nc')
  const r = run(insertLineAbove, 'x\n    y', [{ anchor: 7 }])
  expect(r.doc).toBe('x\n    \n    y')
  expect(r.sel).toEqual([[6, 6]])
})

test('symbols from the syntax tree: JavaScript, Python, Markdown headings', () => {
  const js = EditorState.create({ doc: 'function parseLog(a) {}\nclass GitTile {\n  render() {}\n}\ninterface X {}', extensions: javascript({ typescript: true }) })
  expect(symbols(js).map(s => [s.name, s.kind, s.line])).toEqual([['parseLog', 'funzione', 1], ['GitTile', 'classe', 2], ['render', 'metodo', 3], ['X', 'tipo', 5]])
  const py = EditorState.create({ doc: 'class A:\n    def run(self):\n        pass\n', extensions: python() })
  expect(symbols(py).map(s => s.name)).toEqual(['A', 'run'])
  const md = EditorState.create({ doc: '# Titolo\n\ntesto\n\n## Sotto ##\n', extensions: markdown() })
  expect(symbols(md).map(s => [s.name, s.kind])).toEqual([['Titolo', 'titolo 1'], ['  Sotto', 'titolo 2']])
})
