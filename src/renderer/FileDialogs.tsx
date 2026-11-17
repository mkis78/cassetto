import { useState } from 'react'
import { t } from '../shared/i18n'

export type Choice = 'replace' | 'keep' | 'skip'
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)

// Cancel holds the focus: Enter alone never deletes
export function ConfirmDelete({ paths, permanent, note, onConfirm, onCancel }: { paths: string[]; permanent: boolean; note?: string; onConfirm: () => void; onCancel: () => void }) {
  const n = paths.length
  const what = n === 1 ? `"${nameOf(paths[0])}"` : t('{n} elementi', { n })
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" onKeyDown={e => e.key === 'Escape' && onCancel()}>
        <h3>{permanent ? t('Eliminare definitivamente {what}?', { what }) : t('Spostare nel Cestino {what}?', { what })}</h3>
        {note && <div className="error">{note}</div>}
        {permanent && <div className="hint">{t('Non si potranno recuperare.')}</div>}
        <div className="file-names">
          {paths.slice(0, 10).map(p => (
            <div key={p} className="path" title={p}>
              {nameOf(p)}
            </div>
          ))}
          {n > 10 && <div className="hint">{t('…e altri {n}', { n: n - 10 })}</div>}
        </div>
        <div className="actions">
          <button autoFocus onClick={onCancel}>
            {t('Annulla')}
          </button>
          <button className={permanent ? 'danger' : 'primary'} onClick={onConfirm}>
            {permanent ? t('Elimina definitivamente') : t('Sposta nel Cestino')}
          </button>
        </div>
      </div>
    </div>
  )
}

// one name at a time; "apply to all" answers the rest with the same choice. null: the whole paste is cancelled
export function ConflictDialog({ names, remote, onDone }: { names: string[]; remote: boolean; onDone: (c: Record<string, Choice> | null) => void }) {
  const [i, setI] = useState(0)
  const [all, setAll] = useState(false)
  const [got, setGot] = useState<Record<string, Choice>>({})
  const pick = (c: Choice) => {
    const next = { ...got, ...Object.fromEntries((all ? names.slice(i) : [names[i]]).map(n => [n, c])) }
    if (all || i + 1 >= names.length) return onDone(next)
    setGot(next)
    setI(i + 1)
  }
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onDone(null)}>
      <div className="dialog" onKeyDown={e => e.key === 'Escape' && onDone(null)}>
        <h3>{t('"{name}" esiste già in questa cartella', { name: names[i] })}</h3>
        {names.length > 1 && (
          <label className="check">
            <input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> {t('Applica a tutti ({n})', { n: names.length - i })}
          </label>
        )}
        <div className="actions">
          <button onClick={() => onDone(null)}>{t('Annulla')}</button>
          <button onClick={() => pick('skip')}>{t('Salta')}</button>
          <button className={remote ? 'danger' : ''} onClick={() => pick('replace')}>
            {remote ? t("Sostituisci (elimina definitivamente l'esistente)") : t('Sostituisci')}
          </button>
          <button autoFocus className="primary" onClick={() => pick('keep')}>
            {t('Mantieni entrambi')}
          </button>
        </div>
      </div>
    </div>
  )
}
