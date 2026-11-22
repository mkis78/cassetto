import { EditorView } from '@codemirror/view'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import { resolvedTheme } from './settings'

// the editor's look from the app's colours, so it follows the light and dark themes by itself
export const look = EditorView.theme({
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
// darkTheme tells widgets with &light/&dark styles (the merge view's changes, bars) which variant to use
export const colours = () => [EditorView.darkTheme.of(resolvedTheme() !== 'light'), syntaxHighlighting(resolvedTheme() === 'light' ? defaultHighlightStyle : oneDarkHighlightStyle)]
