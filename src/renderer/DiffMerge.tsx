import { useEffect, useRef } from 'react'
import { MergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { colours, look } from './cmTheme'
import { useTheme } from './settings'

// two read-only sides, unchanged stretches folded; loaded lazily so CodeMirror stays out of the main bundle
export default function DiffMerge({ name, original, modified }: { name: string; original: string; modified: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const theme = useTheme() // a new view on a theme change is simpler than reconfiguring both sides
  useEffect(() => {
    let view: MergeView | undefined
    let live = true
    const desc = LanguageDescription.matchFilename(languages, name)
    // the language by file name first (its own small chunk), then the view, so it never flashes unstyled
    ;(desc ? desc.load().catch(() => []) : Promise.resolve([] as Extension)).then(lang => {
      if (!live) return
      const side = (doc: string) => ({ doc, extensions: [lineNumbers(), look, colours(), lang, EditorView.lineWrapping, EditorState.readOnly.of(true), EditorView.editable.of(false)] })
      view = new MergeView({ parent: ref.current!, a: side(original), b: side(modified), collapseUnchanged: { margin: 3 } })
    })
    return () => ((live = false), view?.destroy())
  }, [name, original, modified, theme])
  return <div className="git-diff-box" ref={ref} />
}
