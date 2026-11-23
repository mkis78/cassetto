import { useSyncExternalStore } from 'react'
import type { Settings } from '../shared/types'
import { tx } from '../shared/i18n'
import { getSettings, onSettings } from './settings'

// optional compartments: off until switched on in Settings
export type ModuleId = 'git' | 'claude'
export const MODULES: { id: ModuleId; name: string; description: string }[] = [
  { id: 'git', name: tx('Git'), description: tx('Rami, commit e modifiche di un repository, in un tab') },
  { id: 'claude', name: tx('Claude Code'), description: tx('Sessioni di Claude Code in un tab, con stato, account e worktree') }
]

export const moduleOn = (s: Settings, id: ModuleId): boolean => !!s.modules?.[id]
export const useModule = (id: ModuleId): boolean => useSyncExternalStore(onSettings, () => moduleOn(getSettings(), id))

// App owns the settings: it handles this event and saves
export const SET_MODULE = 'cassetto:setModule'
export const setModule = (id: ModuleId, on: boolean) => window.dispatchEvent(new CustomEvent(SET_MODULE, { detail: { id, on } }))
