import type { DockviewApi, IDockviewPanel } from 'dockview-react'
import type { TileParams } from '../shared/types'

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

export const closeTiles = (panels: IDockviewPanel[]) => panels.forEach(p => p.api.close())

// the local folder a tab shows, for quick open; none for remote tabs
export function tileFolder(p: IDockviewPanel | undefined): string | null {
  const q = p?.params as TileParams | undefined
  return q && !q.host ? q.path : null
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
