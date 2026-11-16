import type { DockviewApi, IDockviewPanel } from 'dockview-react'
import type { TileParams } from '../shared/types'
import type { Command } from './Palette'

// what each tab offers the action bar, asked for when the bar opens (so it sees the selection of that moment)
const actions = new Map<string, () => Command[]>()
export const setTileActions = (id: string, f: () => Command[]) => (actions.set(id, f), () => void actions.delete(id))
export const tileActions = (id: string) => actions.get(id)

export const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p

// a folder view: a new tab next to the active one ('within'), or a panel beside it
export function openFolder(api: DockviewApi, where: { path: string | null; host: string | null }, nextTo?: string, direction: 'right' | 'below' | 'within' = 'within'): void {
  const ref = nextTo ?? api.activePanel?.id
  const params: TileParams = { kind: 'files', host: where.host, path: where.path }
  api.addPanel({
    id: crypto.randomUUID(),
    component: 'files',
    title: where.host ?? (where.path ? baseName(where.path) || '/' : '~'),
    params,
    position: ref ? { referencePanel: ref, direction } : undefined
  })
}

// keyboard focus for a tab: the element it marks with data-autofocus
export function focusTile(p: IDockviewPanel | undefined): void {
  p?.view.content.element.querySelector<HTMLElement>('[data-autofocus]')?.focus()
}

// editors with unsaved changes: their tab shows a dot, and closing them (or the app) asks first
const dirty = new Set<string>()
const dirtySubs = new Set<() => void>()
export const setDirty = (id: string, d: boolean) => {
  if (d === dirty.has(id)) return
  d ? dirty.add(id) : dirty.delete(id)
  dirtySubs.forEach(f => f())
}
export const isDirty = (id: string) => dirty.has(id)
export const onDirty = (f: () => void) => (dirtySubs.add(f), () => void dirtySubs.delete(f))
const lose = (n: number) => `${n === 1 ? 'Un file ha' : `${n} file hanno`} modifiche non salvate: andranno perse.`

export function closeTiles(panels: IDockviewPanel[]): void {
  const n = panels.filter(p => dirty.has(p.id)).length
  if (n && !confirm(`${lose(n)} Chiudere comunque?`)) return
  panels.forEach(p => (dirty.delete(p.id), p.api.close()))
}

// quitting (Cmd+Q, the window's close button) with unsaved editors: stop, ask, then quit for real
let leaving = false
window.addEventListener('beforeunload', e => {
  if (leaving || !dirty.size) return
  e.preventDefault()
  e.returnValue = false
  setTimeout(() => {
    if (!confirm(`${lose(dirty.size)} Uscire comunque?`)) return
    leaving = true
    void window.api.quit()
  })
})

// a file opens once: asking again shows its tab instead of a second copy
export function openEditor(api: DockviewApi, where: { path: string; host: string | null }, nextTo?: string): void {
  const same = api.panels.find(p => {
    const q = p.params as TileParams | undefined
    return q?.kind === 'editor' && q.path === where.path && q.host === where.host
  })
  if (same) return void (same.api.setActive(), focusTile(same))
  const ref = nextTo ?? api.activePanel?.id
  const params: TileParams = { kind: 'editor', host: where.host, path: where.path }
  api.addPanel({ id: crypto.randomUUID(), component: 'editor', title: baseName(where.path), params, position: ref ? { referencePanel: ref, direction: 'within' } : undefined })
}

// where a tab is: the folder it shows, or the one its terminal was opened in
export function whereOf(p: IDockviewPanel | undefined): { path: string | null; host: string | null } {
  const q = p?.params as TileParams | undefined
  if (!q) return { path: null, host: null }
  if (q.kind === 'editor') return { path: q.path.slice(0, q.path.lastIndexOf('/')) || '/', host: q.host }
  return { path: q.kind === 'terminal' ? q.cwd : q.path, host: q.host }
}

// the local folder a tab is in, for quick open; none for remote tabs
export function tileFolder(p: IDockviewPanel | undefined): string | null {
  const w = whereOf(p)
  return w.host ? null : w.path
}

// a terminal in its own tab, next to `nextTo`, starting in `cwd` (on `host` when remote)
export function openTerminal(api: DockviewApi, where: { cwd: string; host: string | null }, nextTo?: string): void {
  const ref = nextTo ?? api.activePanel?.id
  const params: TileParams = { kind: 'terminal', host: where.host, cwd: where.cwd }
  api.addPanel({
    id: crypto.randomUUID(),
    component: 'terminal',
    title: `${where.host ? `${where.host}: ` : ''}${baseName(where.cwd) || '/'}`,
    params,
    position: ref ? { referencePanel: ref, direction: 'within' } : undefined
  })
}

// through the tabs in layout order, group by group, wrapping around
export function cycleTile(api: DockviewApi | undefined, step: number): void {
  const panels = api?.groups.flatMap(g => g.panels) ?? []
  if (!api || !panels.length) return
  const i = panels.findIndex(p => p.id === api.activePanel?.id)
  const next = panels[(i + step + panels.length) % panels.length]
  next.api.setActive()
  focusTile(next)
}
