import type { AppState, Workspace } from './types'
import { t } from './i18n'

// the workspaces of a saved state; one from before workspaces becomes the first, with its layout
export function withWorkspaces(s: AppState): AppState {
  const workspaces: Workspace[] = s.workspaces?.length ? s.workspaces : [{ id: crypto.randomUUID(), name: t('Spazio {n}', { n: 1 }), layout: s.layout }]
  const activeWs = workspaces.some(w => w.id === s.activeWs) ? s.activeWs : workspaces[0].id
  return { ...s, layout: null, workspaces, activeWs }
}

// `from` takes the place of `to`, the others shift
export function moveWorkspace(list: Workspace[], from: string, to: string): Workspace[] {
  const moved = list.find(w => w.id === from)
  if (!moved || from === to) return list
  const rest = list.filter(w => w.id !== from)
  rest.splice(list.findIndex(w => w.id === to), 0, moved)
  return rest
}
