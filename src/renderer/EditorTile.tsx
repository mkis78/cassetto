import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorSelection, EditorState, Prec } from '@codemirror/state'
import { EditorView, highlightTrailingWhitespace, highlightWhitespace, keymap } from '@codemirror/view'
import { copyLineDown, deleteLine, indentWithTab, moveLineDown, moveLineUp, toggleComment } from '@codemirror/commands'
import { defaultHighlightStyle, foldAll, indentUnit, LanguageDescription, syntaxHighlighting, unfoldAll } from '@codemirror/language'
import { gotoLine, openSearchPanel, selectSelectionMatches } from '@codemirror/search'
import { completeAnyWord } from '@codemirror/autocomplete'
import { Bold, Code, Columns2, Heading1, Heading2, Heading3, Italic, Link as LinkIcon, List, ListChecks, ListOrdered, Quote, SquareCode, SquareCheck, Table, ArrowDownUp, CaseLower, CaseSensitive, CaseUpper, Eraser, FoldVertical, Hash, MessageSquareCode, Pilcrow, Save, Search, SquareSplitVertical, TextCursorInput, UnfoldVertical, WrapText } from 'lucide-react'
import type { Command as PaletteCommand } from './Palette'
import { mdCodeBlock, mdLines, mdLink, mdTable, mdTask, mdWrap, insertLineAbove, joinSelectedLines, lowerCase, sortSelectedLines, splitSelectionByLine, symbols, titleCaseWords, trimTrailingSpaces, upperCase } from './editorCommands'
import { detectIndent } from '../shared/textOps'
import { renderMarkdown } from '../shared/markdown'
import { languages } from '@codemirror/language-data'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import type { EditorParams } from '../shared/types'
import { onSettings, resolvedTheme } from './settings'
import { setDirty, setTileActions } from './tiles'
import { t } from '../shared/i18n'

// the editor's look from the app's colours, so it follows the light and dark themes by itself
const look = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--bg)', color: 'var(--fg)', fontSize: '13px' },
  '.cm-scroller': { fontFamily: "'FiraCode Nerd Font', Menlo, monospace", lineHeight: '1.5' },
  '.cm-gutters': { backgroundColor: 'var(--bar)', color: 'var(--muted)', borderRight: '1px solid var(--line)' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--fg) 5%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'color-mix(in srgb, var(--fg) 8%, transparent)', color: 'var(--fg)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--fg-strong)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'color-mix(in srgb, var(--accent) 35%, transparent) !important' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--fg)', borderColor: 'var(--line2)' },
  '.cm-panel input, .cm-panel button, .cm-textfield': { font: 'inherit', fontSize: '12px' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--yellow) 30%, transparent)' },
  '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--line2)' }
})
const colours = () => syntaxHighlighting(resolvedTheme() === 'light' ? defaultHighlightStyle : oneDarkHighlightStyle)

type Status = { line: number; col: number; cursors: number; selected: number }

const mac = window.api.platform === 'darwin'
// Sublime Text's keys, over CodeMirror's own where they clash (Cmd+Shift+L splits the selection into lines there)
const sublime = (save: () => void, palette: () => void) =>
  Prec.high(
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => (save(), true) },
      { key: 'Mod-Shift-l', run: splitSelectionByLine },
      { key: mac ? 'Ctrl-Mod-g' : 'Alt-F3', run: selectSelectionMatches },
      { key: mac ? 'Ctrl-Mod-ArrowUp' : 'Ctrl-Shift-ArrowUp', run: moveLineUp },
      { key: mac ? 'Ctrl-Mod-ArrowDown' : 'Ctrl-Shift-ArrowDown', run: moveLineDown },
      { key: 'Mod-Shift-d', run: copyLineDown },
      { key: 'Mod-Shift-k', run: deleteLine },
      { key: 'Mod-j', run: joinSelectedLines },
      { key: mac ? 'F5' : 'F9', run: sortSelectedLines },
      { key: 'Mod-Shift-Enter', run: insertLineAbove },
      { key: 'Mod-k Mod-u', run: upperCase },
      { key: 'Mod-k Mod-l', run: lowerCase },
      { key: 'Ctrl-g', run: gotoLine },
      { key: 'Mod-r', run: () => (palette(), true) },
      indentWithTab
    ])
  )
// Markdown only: the formatting keys (GitHub's and Typora's), and the preview of VS Code
const markdownKeys = (preview: () => void) =>
  Prec.high(
    keymap.of([
      { key: 'Mod-b', run: mdWrap('**') },
      { key: 'Mod-i', run: mdWrap('*') },
      { key: 'Mod-e', run: mdWrap('`') },
      { key: 'Mod-Alt-k', run: mdLink },
      { key: 'Mod-Alt-1', run: mdLines('h1') },
      { key: 'Mod-Alt-2', run: mdLines('h2') },
      { key: 'Mod-Alt-3', run: mdLines('h3') },
      { key: 'Mod-Shift-v', run: () => (preview(), true) }
    ])
  )
export const isMarkdown = (name: string) => /\.(md|markdown|mdx|mdown)$/i.test(name)
// a symbol's kind, as editorCommands names it (in Italian, the key), in the language of the interface
const kindLabel = (kind: string) => {
  const h = /^titolo (\d)$/.exec(kind)
  return h ? t('titolo {n}', { n: h[1] }) : t(kind)
}
const openBar = () => window.dispatchEvent(new CustomEvent('cassetto:palette', { detail: 'bar' }))

// a text file in its own tab: CodeMirror, Cmd+S saves, a dot on the tab while unsaved
export default function EditorTile({ api, params }: IDockviewPanelProps<EditorParams>) {
  const { host, path } = params
  const name = path.slice(path.lastIndexOf('/') + 1)
  const ref = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const saved = useRef('') // the text as it is on disk, as far as we know
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirtyState] = useState(false)
  const [status, setStatus] = useState<Status>({ line: 1, col: 1, cursors: 1, selected: 0 })
  const [indent, setIndent] = useState(() => t('Spazi: {n}', { n: 2 }))
  // Alt+Z and the whitespace dots stay with the tab
  const wrapC = useRef(new Compartment()).current
  const spaceC = useRef(new Compartment()).current
  const [wrap, setWrap] = useState(!!params.wrap)
  const [whitespace, setWhitespace] = useState(!!params.whitespace)
  const toggleWrap = () => setWrap(w => (view.current?.dispatch({ effects: wrapC.reconfigure(!w ? EditorView.lineWrapping : []) }), api.updateParameters({ wrap: !w }), !w))
  const toggleSpace = () => setWhitespace(w => (view.current?.dispatch({ effects: spaceC.reconfigure(!w ? [highlightWhitespace(), highlightTrailingWhitespace()] : []) }), api.updateParameters({ whitespace: !w }), !w))
  // Markdown: the preview beside the text, rendered a moment after the last key
  const md = isMarkdown(name)
  const [preview, setPreview] = useState(md && !!params.mdPreview)
  const [html, setHtml] = useState('')
  const togglePreview = () => setPreview(p => (api.updateParameters({ mdPreview: !p }), !p))
  const toggleRef = useRef({ wrap: toggleWrap, space: toggleSpace, preview: togglePreview })
  toggleRef.current = { wrap: toggleWrap, space: toggleSpace, preview: togglePreview }
  const renderTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const renderSoon = (text: string) => {
    clearTimeout(renderTimer.current)
    renderTimer.current = setTimeout(() => setHtml(renderMarkdown(text)), 150)
  }
  const [lang, setLang] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const markDirty = (d: boolean) => (setDirtyState(d), setDirty(api.id, d))

  const save = async () => {
    const v = view.current
    if (!v || params.readOnly) return
    const text = v.state.doc.toString()
    // someone else (git, another app) changed the file since it was opened: ask before writing over it
    const disk = await window.api.readFile(host, path)
    if (disk.ok && disk.text !== saved.current && disk.text !== text && !confirm(t("{name} è cambiato sul disco da quando l'hai aperto. Sovrascriverlo con la tua versione?", { name }))) return
    const r = await window.api.writeFile(host, path, text)
    if (!r.ok) return setNotice(t('Non salvato: {error}', { error: r.error }))
    saved.current = text
    markDirty(v.state.doc.toString() !== text)
    setNotice(t('Salvato'))
    setTimeout(() => setNotice(n => (n === t('Salvato') ? null : n)), 1500)
  }
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    let live = true
    const theme = new Compartment()
    const language = new Compartment()
    window.api.readFile(host, path).then(r => {
      if (!live) return
      if (!r.ok) return setError(r.binary ? t('File binario: non si può modificare come testo.') : r.error)
      saved.current = r.text
      // the file's own indentation: tabs or how many spaces
      const ind = detectIndent(r.text) ?? { tabs: false, size: 2 }
      setIndent(ind.tabs ? t('Tab') : t('Spazi: {n}', { n: ind.size }))
      view.current = new EditorView({
        parent: ref.current!,
        state: EditorState.create({
          doc: r.text,
          extensions: [
            basicSetup,
            EditorState.readOnly.of(!!params.readOnly), // a file inside an archive: Cassetto never writes into a cache
            sublime(() => void saveRef.current(), openBar),
            md ? markdownKeys(() => toggleRef.current.preview()) : [],
            keymap.of([{ key: 'Alt-z', run: () => (toggleRef.current.wrap(), true) }]),
            indentUnit.of(ind.tabs ? '\t' : ' '.repeat(ind.size)),
            EditorState.tabSize.of(ind.size),
            // completions from the words already in the file too, in any language
            EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
            wrapC.of(params.wrap ? EditorView.lineWrapping : []),
            spaceC.of(params.whitespace ? [highlightWhitespace(), highlightTrailingWhitespace()] : []),
            look,
            theme.of(colours()),
            language.of([]),
            EditorView.updateListener.of(u => {
              if (u.docChanged) markDirty(u.state.doc.toString() !== saved.current)
              if (u.docChanged && md) renderSoon(u.state.doc.toString())
              if (u.docChanged || u.selectionSet) {
                const sel = u.state.selection
                const head = sel.main.head
                const line = u.state.doc.lineAt(head)
                setStatus({ line: line.number, col: head - line.from + 1, cursors: sel.ranges.length, selected: sel.ranges.reduce((n, r) => n + r.to - r.from, 0) })
              }
            })
          ]
        })
      })
      view.current.focus()
      if (md) setHtml(renderMarkdown(r.text))
      // the language by file name, loaded only now (each is its own small chunk)
      const desc = LanguageDescription.matchFilename(languages, name)
      if (desc) desc.load().then(support => live && (view.current?.dispatch({ effects: language.reconfigure(support) }), setLang(desc.name)))
    })
    const off = onSettings(() => view.current?.dispatch({ effects: theme.reconfigure(colours()) }))
    return () => {
      live = false
      off()
      clearTimeout(renderTimer.current)
      setDirty(api.id, false)
      view.current?.destroy()
      view.current = null
    }
  }, [host, path])

  // what the editor offers the command palette (Cmd+Shift+P) and the action bar: its commands, then the symbols of the file
  const run = (cmd: (v: EditorView) => boolean) => () => {
    const v = view.current
    if (v) (cmd(v), v.focus())
  }
  const k = (m: string, o: string) => (mac ? m : o)
  const editorActions = (): PaletteCommand[] => {
    const v = view.current
    if (!v) return []
    const group = t('Editor · {name}', { name })
    const cmds: PaletteCommand[] = [
      { label: t('Salva'), hint: 'Cmd+S', run: () => void save(), icon: Save },
      { label: t('Cerca e sostituisci'), hint: 'Cmd+F', run: run(openSearchPanel), icon: Search },
      { label: t('Vai alla riga…'), hint: 'Ctrl+G', run: run(gotoLine), icon: Hash },
      { label: t('Seleziona tutte le occorrenze'), hint: k('Cmd+Ctrl+G', 'Alt+F3'), run: run(selectSelectionMatches), icon: TextCursorInput },
      { label: t('Dividi la selezione in righe'), hint: 'Cmd+Shift+L', run: run(splitSelectionByLine), icon: SquareSplitVertical },
      { label: t('Ordina righe'), hint: k('F5', 'F9'), run: run(sortSelectedLines), icon: ArrowDownUp },
      { label: t('Unisci righe'), hint: 'Cmd+J', run: run(joinSelectedLines), icon: WrapText },
      { label: t('Maiuscolo'), hint: 'Cmd+K Cmd+U', run: run(upperCase), icon: CaseUpper },
      { label: t('Minuscolo'), hint: 'Cmd+K Cmd+L', run: run(lowerCase), icon: CaseLower },
      { label: t('Iniziali maiuscole'), run: run(titleCaseWords), icon: CaseSensitive },
      { label: t('Commenta / decommenta'), hint: 'Cmd+/', run: run(toggleComment), icon: MessageSquareCode },
      { label: t('Rimuovi spazi a fine riga'), run: run(trimTrailingSpaces), icon: Eraser },
      { label: t('Comprimi tutto'), run: run(foldAll), icon: FoldVertical },
      { label: t('Espandi tutto'), run: run(unfoldAll), icon: UnfoldVertical },
      { label: wrap ? t('Disattiva a capo automatico') : t('A capo automatico'), hint: 'Alt+Z', run: toggleWrap, icon: WrapText },
      { label: whitespace ? t('Nascondi spazi') : t('Mostra spazi'), run: toggleSpace, icon: Pilcrow }
    ].map(c => ({ ...c, group }))
    const mdCmds: PaletteCommand[] = !md
      ? []
      : [
          { label: preview ? t('Nascondi anteprima') : t('Mostra anteprima'), hint: 'Cmd+Shift+V', run: togglePreview, icon: Columns2 },
          { label: t('Grassetto'), hint: 'Cmd+B', run: run(mdWrap('**')), icon: Bold },
          { label: t('Corsivo'), hint: 'Cmd+I', run: run(mdWrap('*')), icon: Italic },
          { label: t('Codice'), hint: 'Cmd+E', run: run(mdWrap('`')), icon: Code },
          { label: t('Link'), hint: 'Cmd+Alt+K', run: run(mdLink), icon: LinkIcon },
          { label: t('Titolo 1'), hint: 'Cmd+Alt+1', run: run(mdLines('h1')), icon: Heading1 },
          { label: t('Titolo 2'), hint: 'Cmd+Alt+2', run: run(mdLines('h2')), icon: Heading2 },
          { label: t('Titolo 3'), hint: 'Cmd+Alt+3', run: run(mdLines('h3')), icon: Heading3 },
          { label: t('Elenco puntato'), run: run(mdLines('ul')), icon: List },
          { label: t('Elenco numerato'), run: run(mdLines('ol')), icon: ListOrdered },
          { label: t('Checklist'), run: run(mdLines('task')), icon: ListChecks },
          { label: t('Spunta / togli spunta'), run: run(mdTask), icon: SquareCheck },
          { label: t('Citazione'), run: run(mdLines('quote')), icon: Quote },
          { label: t('Blocco di codice'), run: run(mdCodeBlock), icon: SquareCode },
          { label: t('Tabella'), run: run(mdTable), icon: Table }
        ].map(c => ({ ...c, group: t('Markdown · {name}', { name }) }))
    // ponytail: the whole tree on each opening of the palette; cache by doc version if big files feel slow
    const syms = symbols(v.state).map(s => ({
      label: s.name,
      hint: t('{kind} · riga {line}', { kind: kindLabel(s.kind), line: s.line }),
      group: t('Simboli · {name}', { name }),
      run: () => (v.dispatch({ selection: EditorSelection.cursor(s.from), effects: EditorView.scrollIntoView(s.from, { y: 'center' }) }), v.focus())
    }))
    return [...mdCmds, ...cmds, ...syms]
  }
  const actionsRef = useRef(editorActions)
  actionsRef.current = editorActions
  useEffect(() => setTileActions(api.id, () => actionsRef.current()), [api.id])

  // back to the tab: a file changed on disk while nothing here is unsaved comes in by itself
  useEffect(() => {
    const d = api.onDidActiveChange(async e => {
      if (!e.isActive) return
      view.current?.focus()
      const v = view.current
      if (!v || v.state.doc.toString() !== saved.current) return
      const r = await window.api.readFile(host, path)
      if (r.ok && r.text !== saved.current && view.current === v && v.state.doc.toString() === saved.current) {
        saved.current = r.text
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: r.text } })
        setNotice(t('Ricaricato dal disco'))
      }
    })
    return () => d.dispose()
  }, [host, path])

  return (
    <div className="editor-tile">
      {error ? (
        <div className="files-error">
          <pre>{error}</pre>
        </div>
      ) : (
        <div className="editor-split">
          <div ref={ref} className="editor-body" />
          {/* links do nothing here: main never lets the window navigate */}
          {preview && <div className="note-preview md-preview" dangerouslySetInnerHTML={{ __html: html }} />}
        </div>
      )}
      <div className="status-bar">
        <div className="status-left" title={host ? `${host}:${path}` : path}>
          <b>{name}</b>
          <span>{dirty ? t('Modificato') : t('Salvato su disco')}</span>
          {notice && <span className="editor-notice">{notice}</span>}
        </div>
        {!error && (
          <div className="status-left editor-right">
            {status.cursors > 1 && <span>{t('{n} cursori', { n: status.cursors })}</span>}
            {status.selected > 0 && <span>{t('{n} selezionati', { n: status.selected })}</span>}
            <span>{t('Riga {line}, col {col}', { line: status.line, col: status.col })}</span>
            <span>{indent}</span>
            <span>{lang ?? t('Testo')}</span>
            {md && (
              <button className="status-link" onClick={togglePreview}>
                {preview ? t('Nascondi anteprima') : t('Anteprima')}
              </button>
            )}
            <button className="status-link" disabled={!dirty} onClick={() => void save()}>
              {t('Salva')} (Cmd+S)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
