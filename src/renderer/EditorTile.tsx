import { useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { indentWithTab } from '@codemirror/commands'
import { defaultHighlightStyle, LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import type { EditorParams } from '../shared/types'
import { onSettings, resolvedTheme } from './settings'
import { setDirty } from './tiles'

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

type Status = { line: number; col: number }

// a text file in its own tab: CodeMirror, Cmd+S saves, a dot on the tab while unsaved
export default function EditorTile({ api, params }: IDockviewPanelProps<EditorParams>) {
  const { host, path } = params
  const ref = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const saved = useRef('') // the text as it is on disk, as far as we know
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirtyState] = useState(false)
  const [status, setStatus] = useState<Status>({ line: 1, col: 1 })
  const [lang, setLang] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const name = path.slice(path.lastIndexOf('/') + 1)

  const markDirty = (d: boolean) => (setDirtyState(d), setDirty(api.id, d))

  const save = async () => {
    const v = view.current
    if (!v) return
    const text = v.state.doc.toString()
    // someone else (git, another app) changed the file since it was opened: ask before writing over it
    const disk = await window.api.readFile(host, path)
    if (disk.ok && disk.text !== saved.current && disk.text !== text && !confirm(`${name} è cambiato sul disco da quando l'hai aperto. Sovrascriverlo con la tua versione?`)) return
    const r = await window.api.writeFile(host, path, text)
    if (!r.ok) return setNotice(`Non salvato: ${r.error}`)
    saved.current = text
    markDirty(v.state.doc.toString() !== text)
    setNotice('Salvato')
    setTimeout(() => setNotice(n => (n === 'Salvato' ? null : n)), 1500)
  }
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    let live = true
    const theme = new Compartment()
    const language = new Compartment()
    window.api.readFile(host, path).then(r => {
      if (!live) return
      if (!r.ok) return setError(r.binary ? 'File binario: non si può modificare come testo.' : r.error)
      saved.current = r.text
      view.current = new EditorView({
        parent: ref.current!,
        state: EditorState.create({
          doc: r.text,
          extensions: [
            basicSetup,
            keymap.of([indentWithTab, { key: 'Mod-s', preventDefault: true, run: () => (void saveRef.current(), true) }]),
            look,
            theme.of(colours()),
            language.of([]),
            EditorView.updateListener.of(u => {
              if (u.docChanged) markDirty(u.state.doc.toString() !== saved.current)
              if (u.docChanged || u.selectionSet) {
                const head = u.state.selection.main.head
                const line = u.state.doc.lineAt(head)
                setStatus({ line: line.number, col: head - line.from + 1 })
              }
            })
          ]
        })
      })
      view.current.focus()
      // the language by file name, loaded only now (each is its own small chunk)
      const desc = LanguageDescription.matchFilename(languages, name)
      if (desc) desc.load().then(support => live && (view.current?.dispatch({ effects: language.reconfigure(support) }), setLang(desc.name)))
    })
    const off = onSettings(() => view.current?.dispatch({ effects: theme.reconfigure(colours()) }))
    return () => {
      live = false
      off()
      setDirty(api.id, false)
      view.current?.destroy()
      view.current = null
    }
  }, [host, path])

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
        setNotice('Ricaricato dal disco')
      }
    })
    return () => d.dispose()
  }, [host, path])

  return (
    <div className="editor-tile">
      {error ? <div className="files-error"><pre>{error}</pre></div> : <div ref={ref} className="editor-body" />}
      <div className="status-bar">
        <div className="status-left" title={host ? `${host}:${path}` : path}>
          <b>{name}</b>
          <span>{dirty ? 'Modificato' : 'Salvato su disco'}</span>
          {notice && <span className="editor-notice">{notice}</span>}
        </div>
        {!error && (
          <div className="status-left editor-right">
            <span>Riga {status.line}, col {status.col}</span>
            <span>{lang ?? 'Testo'}</span>
            <button className="status-link" disabled={!dirty} onClick={() => void save()}>
              Salva (Cmd+S)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
