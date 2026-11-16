import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import type { TerminalParams } from '../shared/types'
import { onSettings, resolvedTheme } from './settings'

// VS Code's light terminal colours: the default ANSI ones are unreadable on white
const LIGHT = {
  background: '#ffffff', foreground: '#2b303a', cursor: '#2b303a', cursorAccent: '#ffffff', selectionBackground: '#c7d5e8',
  black: '#000000', red: '#cd3131', green: '#107c10', yellow: '#949800', blue: '#0451a5', magenta: '#bc05bc', cyan: '#0598bc', white: '#555555',
  brightBlack: '#666666', brightRed: '#cd3131', brightGreen: '#14ce14', brightYellow: '#b5ba00', brightBlue: '#0451a5', brightMagenta: '#bc05bc', brightCyan: '#0598bc', brightWhite: '#a5a5a5'
}
const termTheme = () => (resolvedTheme() === 'light' ? LIGHT : { background: '#14161b' })
onSettings(() => live.forEach(e => (e.term.options.theme = termTheme())))

interface Entry {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
  off: (() => void)[]
  onFind: () => void
}

// xterm instances outlive React mounts: dockview remounts a panel's content when a tab is moved or the
// layout is rebuilt (arrangements, saved layouts), and recreating the terminal would kill its shell
const live = new Map<string, Entry>()

export function attachTerminal(id: string, params: TerminalParams, el: HTMLElement, onFind: () => void): () => void {
  let e = live.get(id)
  if (!e) {
    const term = new Terminal({ fontFamily: "'FiraCode Nerd Font', Menlo, monospace", fontSize: 13, cursorBlink: true, allowProposedApi: true, theme: termTheme() })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.open(el)
    // Cmd+F (Ctrl+Shift+F on Linux) searches the output. Linux: Ctrl+Shift+C/V copy/paste, plain Ctrl+C stays an interrupt
    term.attachCustomKeyEventHandler(ev => {
      const mac = window.api.platform === 'darwin'
      if (ev.type !== 'keydown' || !(mac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && ev.shiftKey)) return true
      if (ev.code === 'KeyF') return ev.preventDefault(), live.get(id)?.onFind(), false
      if (mac || (ev.code !== 'KeyC' && ev.code !== 'KeyV')) return true
      ev.preventDefault()
      void terminalAction(id, ev.code === 'KeyC' ? 'copy' : 'paste')
      return false
    })
    fit.fit()
    const input = term.onData(d => window.api.ptyWrite(id, d))
    const off = [
      window.api.onPtyData(id, d => term.write(d)),
      window.api.onPtyExit(id, code => term.write(`\r\n\x1b[90m[terminale chiuso, codice ${code}]\x1b[0m\r\n`)),
      () => input.dispose()
    ]
    e = { term, fit, search, off, onFind }
    live.set(id, e)
    window.api.ptyCreate(id, { host: params.host, cwd: params.cwd }, term.cols, term.rows).catch((err: Error) =>
      term.write(`\x1b[31m${err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}\x1b[0m\r\n`)
    )
  } else if (e.term.element && e.term.element.parentElement !== el) {
    el.appendChild(e.term.element)
  }
  e.onFind = onFind
  const entry = e
  const ro = new ResizeObserver(() => {
    if (el.clientWidth === 0 || el.clientHeight === 0) return // hidden tab
    entry.fit.fit()
    window.api.ptyResize(id, entry.term.cols, entry.term.rows)
  })
  ro.observe(el)
  return () => ro.disconnect()
}

export const isTerminal = (id: string) => live.has(id)
export const hasSelection = (id: string) => !!live.get(id)?.term.hasSelection()
export const focusTerminal = (id: string) => live.get(id)?.term.focus()

export async function terminalAction(id: string, action: 'copy' | 'paste' | 'selectAll' | 'clear'): Promise<void> {
  const t = live.get(id)?.term
  if (!t) return
  if (action === 'copy') await window.api.clipboardWrite(t.getSelection())
  if (action === 'paste') t.paste(await window.api.clipboardRead())
  if (action === 'selectAll') t.selectAll()
  if (action === 'clear') t.clear()
  t.focus()
}

export function destroyTerminal(id: string): void {
  const e = live.get(id)
  if (!e) return
  live.delete(id)
  window.api.ptyKill(id)
  e.off.forEach(f => f())
  e.term.dispose()
}

// search in a terminal's output, from the bar its tab shows on Cmd+F
const MATCHES = { matchBackground: '#5a4a2b', activeMatchBackground: '#d8a657', matchOverviewRuler: '#d8a657', activeMatchColorOverviewRuler: '#ea6962' }
export function findInTerminal(id: string, text: string, o: { back?: boolean; typing?: boolean } = {}): void {
  const s = live.get(id)?.search
  if (!s) return
  if (!text) return s.clearDecorations()
  const opts = { decorations: MATCHES, incremental: o.typing }
  if (o.back) s.findPrevious(text, opts)
  else s.findNext(text, opts)
}
export function endFind(id: string): void {
  const e = live.get(id)
  e?.search.clearDecorations()
  e?.term.clearSelection()
  e?.term.focus()
}
export function onFindResults(id: string, cb: (index: number, count: number) => void): () => void {
  const d = live.get(id)?.search.onDidChangeResults(r => cb(r.resultIndex, r.resultCount))
  return () => d?.dispose()
}
