import { describe, expect, test } from 'vitest'
import { createStore, inputEvent, needsAttention, nextState } from '../src/shared/claudeState'

describe('nextState', () => {
  test('a prompt starts work', () => expect(nextState('idle', 'prompt')).toBe('working'))
  test('a permission request waits for the user', () => expect(nextState('working', 'permission')).toBe('waiting'))
  test('a tool run after approval is work again', () => expect(nextState('waiting', 'tool')).toBe('working'))
  test('stop finishes the turn', () => expect(nextState('working', 'stop')).toBe('done'))
  test('focus marks a finished turn as seen', () => expect(nextState('done', 'focus')).toBe('idle'))
  test('focus does not dismiss a pending question', () => expect(nextState('waiting', 'focus')).toBe('waiting'))
  test('exit always goes idle', () => expect(nextState('waiting', 'exit')).toBe('idle'))
  test('typing an answer clears a pending question (denial fires no hook)', () => expect(nextState('waiting', 'input')).toBe('idle'))
  test('typing while working keeps working (queued message)', () => expect(nextState('working', 'input')).toBe('working'))
  test('Esc interrupts work (interrupt fires no Stop hook)', () => expect(nextState('working', 'interrupt')).toBe('idle'))
})

test('needsAttention is only for waiting and done', () => {
  expect(['idle', 'working', 'waiting', 'done'].map(s => needsAttention(s as never))).toEqual([false, false, true, true])
})

describe('inputEvent', () => {
  test('a lone Esc is an interrupt', () => expect(inputEvent('\x1b')).toBe('interrupt'))
  test('arrow keys are plain input', () => expect(inputEvent('\x1b[A')).toBe('input'))
  test('text is plain input', () => expect(inputEvent('y')).toBe('input'))
})

describe('store', () => {
  test('stop on the tile being watched is already seen', () => {
    const s = createStore()
    s.dispatch('a', 'prompt')
    s.dispatch('a', 'stop', true)
    expect(s.get('a')).toBe('idle')
  })

  test('unknown id starts idle and dispatch creates it', () => {
    const s = createStore()
    expect(s.get('x')).toBe('idle')
    s.dispatch('x', 'permission')
    expect(s.get('x')).toBe('waiting')
  })

  test('remove clears attention and notifies subscribers', () => {
    const s = createStore()
    let calls = 0
    s.subscribe(() => calls++)
    s.dispatch('a', 'stop')
    expect(s.anyAttention(['a', 'b'])).toBe(true)
    s.remove('a')
    expect(s.anyAttention(['a', 'b'])).toBe(false)
    expect(calls).toBe(2)
  })

  test('late events for a closed tile are ignored', () => {
    const s = createStore()
    s.dispatch('a', 'prompt')
    s.remove('a')
    s.dispatch('a', 'stop')
    expect(s.get('a')).toBe('idle')
    expect(s.anyAttention(['a'])).toBe(false)
  })

  test('a reopened tile reports again', () => {
    const s = createStore()
    s.remove('a')
    s.reopen('a')
    s.dispatch('a', 'prompt')
    expect(s.get('a')).toBe('working')
  })

  test('unsubscribe stops notifications', () => {
    const s = createStore()
    let calls = 0
    const off = s.subscribe(() => calls++)
    off()
    s.dispatch('a', 'prompt')
    expect(calls).toBe(0)
  })
})
