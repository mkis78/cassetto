import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { AppState } from '../shared/types'

export const defaultState = (): AppState => ({ layout: null })

export function loadState(file: string): AppState {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return defaultState() // first run
  }
  try {
    const s = JSON.parse(text) as AppState
    if (typeof s !== 'object' || s === null || !('layout' in s)) throw new Error('no layout')
    return s
  } catch {
    renameSync(file, file + '.bad') // keep it for manual recovery instead of overwriting it on the next save
    return defaultState()
  }
}

export function saveState(file: string, s: AppState): void {
  writeFileSync(file + '.tmp', JSON.stringify(s))
  renameSync(file + '.tmp', file)
}
