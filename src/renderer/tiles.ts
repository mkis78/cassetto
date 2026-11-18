import type { DockviewApi, IDockviewPanel } from 'dockview-react'
import type { TileParams } from '../shared/types'
import type { Command } from './Palette'
import { t } from '../shared/i18n'

// what each tab offers the action bar, asked for when the bar opens (so it sees the selection of that moment)
const actions = new Map<string, () => Command[]>()
export const setTileActions = (id: string, f: () => Command[]) => (actions.set(id, f), () => void actions.delete(id))
export const tileActions = (id: string) => actions.get(id)

// a tile changed these folders: the other tiles showing one of them list it again
export const CHANGED = 'cassetto:changed'
export const changed = (from: string, dirs: string[]) => window.dispatchEvent(new CustomEvent(CHANGED, { detail: { from, dirs } }))

// undo the last file operation; App shows the outcome as a toast
export async function runUndo(): Promise<void> {
  const r = await window.api.undo()
  if (!r) return
  changed('undo', r.dirs)
  const text = r.failed.length ? r.failed.map(f => `${f.path}: ${f.error}`).join('\n') : t('Annullato: {label}', { label: r.label })
  window.dispatchEvent(new CustomEvent('cassetto:toast', { detail: { text, error: r.failed.length > 0 } }))
}

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

// a folder from the sidebar: in the Files tab in front when it is on the same host (it stays on one host for life),
// otherwise, or when asked, in a new tab; path null is the host's home
export const NAVIGATE = 'cassetto:navigate'
export function navigate(api: DockviewApi, where: { host: string | null; path: string | null }, newTab: boolean): void {
  const p = api.activePanel
  const q = p?.params as TileParams | undefined
  if (p && !newTab && q?.kind === 'files' && q.host === where.host) window.dispatchEvent(new CustomEvent(NAVIGATE, { detail: { id: p.id, path: where.path } }))
  else openFolder(api, where)
}
// what a sidebar item carries when dragged onto a panel: { host, path }
export const PLACE_DND = 'cassetto/place'
// a folder for the sidebar's Favourites, from a Files tile; App keeps the list
export const FAVOURITE = 'cassetto:favourite'
export const addToFavourites = (host: string | null, path: string) => window.dispatchEvent(new CustomEvent(FAVOURITE, { detail: { host, path } }))

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
const lose = (n: number) => (n === 1 ? t('Un file ha modifiche non salvate: andranno perse.') : t('{n} file hanno modifiche non salvate: andranno perse.', { n }))

export function closeTiles(panels: IDockviewPanel[]): void {
  const n = panels.filter(p => dirty.has(p.id)).length
  if (n && !confirm(`${lose(n)} ${t('Chiudere comunque?')}`)) return
  panels.forEach(p => (dirty.delete(p.id), p.api.close()))
}

// quitting (Cmd+Q, the window's close button) with unsaved editors: stop, ask, then quit for real
let leaving = false
// a restart asked for in the app: asks here, once, so the quit that follows does not ask again (or stay pending)
export function leaveAsking(): boolean {
  if (dirty.size && !confirm(`${lose(dirty.size)} ${t('Riavviare comunque?')}`)) return false
  return (leaving = true)
}
window.addEventListener('beforeunload', e => {
  if (leaving || !dirty.size) return
  e.preventDefault()
  e.returnValue = false
  setTimeout(() => {
    if (!confirm(`${lose(dirty.size)} ${t('Uscire comunque?')}`)) return
    leaving = true
    void window.api.quit()
  })
})

// a file opens once: asking again shows its tab instead of a second copy
export function openEditor(api: DockviewApi, where: { path: string; host: string | null; readOnly?: boolean }, nextTo?: string): void {
  const same = api.panels.find(p => {
    const q = p.params as TileParams | undefined
    return q?.kind === 'editor' && q.path === where.path && q.host === where.host
  })
  if (same) return void (same.api.setActive(), focusTile(same))
  const ref = nextTo ?? api.activePanel?.id
  const params: TileParams = { kind: 'editor', host: where.host, path: where.path, ...(where.readOnly && { readOnly: true }) }
  api.addPanel({ id: crypto.randomUUID(), component: 'editor', title: baseName(where.path), params, position: ref ? { referencePanel: ref, direction: 'within' } : undefined })
}

// where a tab is: the folder it shows (inside an archive: the folder holding it, never a cache), or the one its terminal was opened in
export function whereOf(p: IDockviewPanel | undefined): { path: string | null; host: string | null } {
  const q = p?.params as TileParams | undefined
  if (!q) return { path: null, host: null }
  if (q.kind === 'editor') return { path: q.path.slice(0, q.path.lastIndexOf('/')) || '/', host: q.host }
  if (q.kind === 'files' && q.archives?.length) return { path: q.archives[0].archive.slice(0, q.archives[0].archive.lastIndexOf('/')) || '/', host: q.host }
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
