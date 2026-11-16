import { useEffect, type RefObject } from 'react'
import { listKey } from '../shared/listNav'

// Arrows, Enter and Esc for an open in-page menu whose items are the children of `ref`.
// Captured on window, so a focused terminal never sees these keys while the menu is open.
export function useMenuKeys(ref: RefObject<HTMLElement | null>, open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return
    let at = 0
    const items = () => [...(ref.current?.children ?? [])] as HTMLElement[]
    const mark = () => items().forEach((c, i) => c.classList.toggle('active', i === at))
    mark()
    const key = (e: KeyboardEvent) => {
      const next = listKey(e.key, at, items().length)
      if (next !== null) (at = next), mark()
      else if (e.key === 'Enter') items()[at]?.click()
      else if (e.key === 'Escape') onClose()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [open])
}
