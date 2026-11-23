import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Terminal } from '@xterm/xterm'
import type { ClaudeParams, TerminalParams } from '../shared/types'
import { inputEvent } from '../shared/claudeState'
import { claudeStore } from './claudeStore'
import { findPaths, resolvePath } from '../shared/termLinks'
import { onSettings, resolvedTheme } from './settings'
import { t } from '../shared/i18n'

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
  hooks: TerminalHooks
}

// what the tab mounted last wants: Cmd+F shows its search bar; onLink: a clicked file (on the terminal's host);
// onFallback: a resumed Claude session was not found
export interface TerminalHooks {
  onFind: () => void
  onLink: (path: string, line?: number) => void
  onFallback?: () => void
}

// does a file exist: its folder listed (here or over ssh), the answer kept a few seconds for the next hovers
const listed = new Map<string, { at: number; files: Promise<Set<string>> }>()
function fileExists(host: string | null, path: string): Promise<boolean> {
  const cut = path.lastIndexOf('/')
  const dir = path.slice(0, cut) || '/'
  const key = `${host ?? ''}:${dir}`
  let c = listed.get(key)
  if (!c || Date.now() - c.at > 5000) {
    if (listed.size > 200) listed.clear() // ponytail: crude bound, the cache only saves repeat listings
    c = { at: Date.now(), files: window.api.listDir(host, dir).then(r => new Set(r.ok ? r.listing.entries.filter(e => !e.dir).map(e => e.name) : [])).catch(() => new Set<string>()) }
    listed.set(key, c)
  }
  return c.files.then(f => f.has(path.slice(cut + 1)))
}

// Cmd+click (Ctrl+click on Linux) on a file printed in a terminal opens it at its line. Paths resolve against the folder
// the process is in now (a local shell follows the user's cd; an SSH one stays at the folder it was opened in),
// and only files that exist there become links.
function linkFiles(id: string, params: TerminalParams | ClaudeParams, term: Terminal): void {
  const host = params.kind === 'terminal' ? params.host : null
  const home = host ? null : window.api.homeDir()
  let asked = 0
  // asked again at most every 2 s: hovering line after line costs one lsof, not one per line
  let cwd = { dir: Promise.resolve(params.cwd), at: 0 }
  const folder = () => {
    if (!host && Date.now() - cwd.at > 2000) cwd = { dir: window.api.ptyCwd(id).then(d => d ?? params.cwd, () => params.cwd), at: Date.now() }
    return cwd.dir
  }
  term.registerLinkProvider({
    provideLinks: (y, done) => {
      const n = ++asked
      const row = term.buffer.active.getLine(y - 1)
      if (!row) return done(undefined)
      // the text with, for each character, its cell: wide characters (emoji, CJK) take two
      let text = ''
      const cells: number[] = []
      for (let x = 0; x < term.cols; x++) {
        const cell = row.getCell(x)
        if (!cell || cell.getWidth() === 0) continue
        const ch = cell.getChars() || ' '
        for (let k = 0; k < ch.length; k++) cells.push(x)
        text += ch
      }
      const found = findPaths(text)
      if (!found.length) return done(undefined)
      void folder().then(dir => {
        const refs = found.flatMap(r => {
          const full = resolvePath(dir, r.path, home)
          return full ? [{ r, full }] : []
        })
        return Promise.all(refs.map(x => fileExists(host, x.full))).then(ok => ({ refs, ok }))
      }).then(({ refs, ok }) => {
        if (n !== asked) return // the mouse is on another line by now: xterm would file this answer under it
        done(
          refs.flatMap(({ r, full }, i) =>
            ok[i]
              ? [{
                  range: { start: { x: cells[r.start] + 1, y }, end: { x: cells[r.start + r.text.length - 1] + 1, y } },
                  text: r.text,
                  activate: (e: MouseEvent) => void ((window.api.platform === 'darwin' ? e.metaKey : e.ctrlKey) && live.get(id)?.hooks.onLink(full, r.line))
                }]
              : []
          )
        )
      })
    }
  })
}

// xterm instances outlive React mounts: dockview remounts a panel's content when a tab is moved or the
// layout is rebuilt (arrangements, saved layouts), and recreating the terminal would kill its shell
const live = new Map<string, Entry>()

export function attachTerminal(id: string, params: TerminalParams | ClaudeParams, el: HTMLElement, hooks: TerminalHooks): () => void {
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
      if (ev.code === 'KeyF') return ev.preventDefault(), live.get(id)?.hooks.onFind(), false
      if (mac || (ev.code !== 'KeyC' && ev.code !== 'KeyV')) return true
      ev.preventDefault()
      void terminalAction(id, ev.code === 'KeyC' ? 'copy' : 'paste')
      return false
    })
    fit.fit()
    // keystrokes move a Claude's state too: answering or Esc fires no hook
    const claude = params.kind === 'claude'
    if (claude) claudeStore.reopen(id) // closed before (saved layout, compartment off and on): report again
    const input = term.onData(d => (window.api.ptyWrite(id, d), claude && claudeStore.dispatch(id, inputEvent(d))))
    const off = [
      window.api.onPtyData(id, d => term.write(d)),
      window.api.onPtyExit(id, (code, fallback) => {
        if (claude) claudeStore.dispatch(id, 'exit')
        const onFallback = live.get(id)?.hooks.onFallback
        if (fallback && onFallback) onFallback()
        else term.write(`\r\n\x1b[90m[${t('terminale chiuso, codice {code}', { code })}]\x1b[0m\r\n`)
      }),
      () => input.dispose()
    ]
    e = { term, fit, search, off, hooks }
    live.set(id, e)
    linkFiles(id, params, term)
    spawn(id, params, term)
  } else if (e.term.element && e.term.element.parentElement !== el) {
    el.appendChild(e.term.element)
  }
  e.hooks = hooks
  const entry = e
  const ro = new ResizeObserver(() => {
    if (el.clientWidth === 0 || el.clientHeight === 0) return // hidden tab
    entry.fit.fit()
    window.api.ptyResize(id, entry.term.cols, entry.term.rows)
  })
  ro.observe(el)
  return () => ro.disconnect()
}

function spawn(id: string, params: TerminalParams | ClaudeParams, term: Terminal): void {
  const p = params.kind === 'claude' ? params : { host: params.host, cwd: params.cwd }
  window.api.ptyCreate(id, p, term.cols, term.rows).catch((err: Error) =>
    term.write(`\x1b[31m${err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}\x1b[0m\r\n`)
  )
}

// the same terminal, a new process (a Claude whose session was not found, with a new one)
export function restartTerminal(id: string, params: ClaudeParams, notice: string): void {
  const e = live.get(id)
  if (!e) return
  e.term.write(`\r\n\x1b[90m${notice}\x1b[0m\r\n`)
  spawn(id, params, e.term)
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
  claudeStore.remove(id) // hooks still in flight must not bring its state back
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
