import type { ClaudeEvent } from './types'

export type ClaudeState = 'idle' | 'working' | 'waiting' | 'done'
// input/interrupt come from the user's keystrokes: denying a permission or pressing Esc fires no hook
export type StateEvent = ClaudeEvent | 'focus' | 'exit' | 'input' | 'interrupt'

export function nextState(s: ClaudeState, e: StateEvent): ClaudeState {
  switch (e) {
    case 'prompt':
    case 'tool':
      return 'working'
    case 'permission':
      return 'waiting'
    case 'stop':
      return 'done'
    case 'focus':
      return s === 'done' ? 'idle' : s
    case 'exit':
      return 'idle'
    case 'input':
      return s === 'waiting' ? 'idle' : s
    case 'interrupt':
      return s === 'working' || s === 'waiting' ? 'idle' : s
  }
}

export const inputEvent = (data: string): 'input' | 'interrupt' => (data === '\x1b' ? 'interrupt' : 'input')

export const needsAttention = (s: ClaudeState): boolean => s === 'waiting' || s === 'done'

export function createStore() {
  const states = new Map<string, ClaudeState>()
  const closed = new Set<string>() // hooks still in flight when a tile closes must not bring it back
  const subs = new Set<() => void>()
  const notify = () => subs.forEach(f => f())
  return {
    get: (id: string): ClaudeState => states.get(id) ?? 'idle',
    all: (): Map<string, ClaudeState> => new Map(states),
    // watched: the tile is on screen and focused, so a finished turn is already seen
    dispatch(id: string, e: StateEvent, watched = false): void {
      if (closed.has(id)) return
      const prev = states.get(id) ?? 'idle'
      const n = nextState(prev, e)
      const next = n === 'done' && watched ? 'idle' : n
      if (next === prev) return
      states.set(id, next)
      notify()
    },
    remove(id: string): void {
      closed.add(id)
      if (states.delete(id)) notify()
    },
    // the same tab back (a saved layout, the compartment turned on again): its new process reports again
    reopen(id: string): void {
      closed.delete(id)
    },
    anyAttention: (ids: string[]): boolean => ids.some(id => needsAttention(states.get(id) ?? 'idle')),
    subscribe(f: () => void): () => void {
      subs.add(f)
      return () => subs.delete(f)
    }
  }
}

// who needs you first, then who is busy
const RANK: Record<ClaudeState, number> = { waiting: 0, done: 1, working: 2, idle: 3 }
export const overviewOrder = <T extends { state: ClaudeState }>(items: T[]): T[] => [...items].sort((a, b) => RANK[a.state] - RANK[b.state]) // stable: ties keep tab order
