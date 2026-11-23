import { useSyncExternalStore } from 'react'
import { createStore, type ClaudeState } from '../shared/claudeState'

// what each Claude tab is doing, fed by its hooks (App) and its keystrokes (terminals)
export const claudeStore = createStore()

export const subscribe = claudeStore.subscribe
export const claudeStates = claudeStore.all
export const useClaudeState = (id: string): ClaudeState => useSyncExternalStore(subscribe, () => claudeStore.get(id))
