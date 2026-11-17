import { useEffect, useRef } from 'react'
import type { SearchQuery } from '../shared/types'
import { DEFAULT_MAX, MAX_CHOICES } from '../shared/query'
import { locale, t, tx } from '../shared/i18n'

const CASES = [
  { id: 'smart', label: tx('Automatico'), hint: tx('distingue solo se scrivi una maiuscola') },
  { id: 'match', label: tx('Distingui'), hint: tx('«Foto» non trova «foto»') },
  { id: 'ignore', label: tx('Ignora'), hint: tx('«FOTO» trova anche «foto»') }
] as const

// the search criteria, under the search bar; every change searches again
export default function SearchOptions({ q, set, onClose }: { q: SearchQuery; set: (o: Partial<SearchQuery>) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  // a click outside (the Opzioni button included, which toggles it itself) or Esc closes it
  useEffect(() => {
    const down = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.('.search-opts-btn') && onClose()
    document.addEventListener('pointerdown', down)
    return () => document.removeEventListener('pointerdown', down)
  }, [onClose])
  const content = q.mode === 'content'
  const caseNow = CASES.find(c => c.id === (q.case ?? 'smart'))!
  return (
    <div ref={ref} className="search-opts" role="dialog" aria-label={t('Opzioni di ricerca')} onKeyDown={e => e.key === 'Escape' && (e.stopPropagation(), onClose())}>
      {q.mode !== 'tag' && (
      <>
      <div className="opt-row">
        <span className="opt-label">{t('Maiuscole')}</span>
        <div className="segmented">
          {CASES.map(c => (
            <button key={c.id} className={caseNow.id === c.id ? 'on' : ''} title={t(c.hint)} onClick={() => set({ case: c.id })}>
              {t(c.label)}
            </button>
          ))}
        </div>
      </div>
      <p className="opt-hint">{t(caseNow.hint)}</p>
      </>
      )}

      <label className="opt-check">
        <input type="checkbox" checked={q.subfolders !== false} onChange={e => set({ subfolders: e.target.checked })} /> {t('Cerca anche nelle sottocartelle')}
      </label>
      {/* only where they apply: by name a pattern is already a glob (*.pdf), so these would do nothing */}
      {content && (
        <>
          <label className="opt-check">
            <input type="checkbox" checked={q.word} onChange={e => set({ word: e.target.checked })} /> {t('Parola intera')}
          </label>
          <label className="opt-check">
            <input type="checkbox" checked={q.regex} onChange={e => set({ regex: e.target.checked })} /> {t('Espressione regolare')}
          </label>
        </>
      )}

      <label className="opt-field">
        <span className="opt-label">{t('Solo questi file')}</span>
        <input spellCheck={false} value={q.include ?? ''} placeholder="*.pdf, *.md, docs/*.txt" onChange={e => set({ include: e.target.value })} />
      </label>
      <label className="opt-field">
        <span className="opt-label">{t('Escludi')}</span>
        <input spellCheck={false} value={q.exclude ?? ''} placeholder="node_modules, *.log, build" onChange={e => set({ exclude: e.target.value })} />
      </label>
      <p className="opt-hint">{t('Separati da virgole. Un nome vale ovunque (node_modules), un percorso dalla cartella cercata (src/vecchi).')}</p>

      <div className="opt-row">
        <span className="opt-label">{t('Massimo risultati')}</span>
        <select value={q.max ?? DEFAULT_MAX} onChange={e => set({ max: Number(e.target.value) })}>
          {MAX_CHOICES.map(n => (
            <option key={n} value={n}>
              {n.toLocaleString(locale())}
            </option>
          ))}
        </select>
      </div>

      <div className="opt-actions">
        <button onClick={() => set({ case: undefined, subfolders: undefined, word: false, regex: false, include: undefined, exclude: undefined, max: undefined })}>{t('Ripristina')}</button>
        <button className="primary" onClick={onClose}>{t('Fatto')}</button>
      </div>
    </div>
  )
}
