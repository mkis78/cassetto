import { useState } from 'react'
import { t, tx } from '../shared/i18n'
import { conflicts, renamed, type RenameRule } from '../shared/batchRename'

type Kind = RenameRule['kind']
const KINDS: [Kind, string][] = [['replace', tx('Sostituisci testo')], ['add', tx('Aggiungi testo')], ['format', tx('Formato')], ['case', tx('Maiuscole e minuscole')]]
const int = (v: string, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.trunc(Number(v)) || 0))

// names: the selection in list order (Formato numbers them so); existing: every name in the folder; pairs back are names
export default function BatchRename({ names, existing, fold, onApply, onClose }: { names: string[]; existing: string[]; fold: (s: string) => string; onApply: (pairs: { from: string; to: string }[]) => void; onClose: () => void }) {
  const [kind, setKind] = useState<Kind>('replace')
  const [replace, setReplace] = useState({ find: '', with: '', caseSensitive: false })
  const [add, setAdd] = useState<{ text: string; where: 'before' | 'after' }>({ text: '', where: 'after' })
  const [format, setFormat] = useState<{ base: string; where: 'before' | 'after'; start: number; digits: number }>({ base: t('File'), where: 'after', start: 1, digits: 2 })
  const [to, setTo] = useState<'lower' | 'upper' | 'title'>('lower')
  const [includeExt, setIncludeExt] = useState(false)
  const rule: RenameRule = kind === 'replace' ? { kind, ...replace } : kind === 'add' ? { kind, ...add } : kind === 'format' ? { kind, ...format } : { kind, to }
  const next = renamed(names, rule, includeExt)
  const pairs = names.map((from, i) => ({ from, to: next[i] }))
  const errors = conflicts(pairs, existing, fold)
  const changed = pairs.filter(p => p.to !== p.from)
  const ok = changed.length > 0 && errors.every(e => !e)
  const apply = () => ok && onApply(changed)
  const where = (v: 'before' | 'after', set: (w: 'before' | 'after') => void, before: string, after: string) => (
    <select value={v} onChange={e => set(e.target.value as 'before' | 'after')}>
      <option value="before">{before}</option>
      <option value="after">{after}</option>
    </select>
  )
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog batch-rename" onKeyDown={e => (e.key === 'Escape' ? onClose() : e.key === 'Enter' && !e.nativeEvent.isComposing && !(e.target instanceof HTMLButtonElement) && !(e.target instanceof HTMLSelectElement) && (e.preventDefault(), apply()))}>
        {/* Enter applies from any field; a focused button or select, and an IME composing text, keep their own Enter */}
        <h3>{t('Rinomina {n} elementi', { n: names.length })}</h3>
        <select autoFocus value={kind} onChange={e => setKind(e.target.value as Kind)}>
          {KINDS.map(([k, label]) => (
            <option key={k} value={k}>
              {t(label)}
            </option>
          ))}
        </select>
        {kind === 'replace' && (
          <>
            <label>{t('Trova')}</label>
            <input spellCheck={false} value={replace.find} onChange={e => setReplace({ ...replace, find: e.target.value })} />
            <label>{t('Sostituisci con')}</label>
            <input spellCheck={false} value={replace.with} onChange={e => setReplace({ ...replace, with: e.target.value })} />
            <label className="check">
              <input type="checkbox" checked={replace.caseSensitive} onChange={e => setReplace({ ...replace, caseSensitive: e.target.checked })} /> {t('Maiuscole/minuscole')}
            </label>
          </>
        )}
        {kind === 'add' && (
          <>
            <label>{t('Testo')}</label>
            <div className="row">
              <input spellCheck={false} value={add.text} onChange={e => setAdd({ ...add, text: e.target.value })} />
              {where(add.where, w => setAdd({ ...add, where: w }), t('Prima del nome'), t('Dopo il nome'))}
            </div>
          </>
        )}
        {kind === 'format' && (
          <>
            <label>{t('Nome')}</label>
            <div className="row">
              <input spellCheck={false} value={format.base} onChange={e => setFormat({ ...format, base: e.target.value })} />
              {where(format.where, w => setFormat({ ...format, where: w }), t('Numero prima'), t('Numero dopo'))}
            </div>
            <div className="row">
              <label>{t('Inizia da')}</label>
              <input type="number" min={0} value={format.start} onChange={e => setFormat({ ...format, start: int(e.target.value, 0, 1e9) })} />
              <label>{t('Cifre')}</label>
              <input type="number" min={1} max={6} value={format.digits} onChange={e => setFormat({ ...format, digits: int(e.target.value, 1, 6) })} />
            </div>
          </>
        )}
        {kind === 'case' && (
          <select value={to} onChange={e => setTo(e.target.value as typeof to)}>
            <option value="lower">{t('tutto minuscolo')}</option>
            <option value="upper">{t('TUTTO MAIUSCOLO')}</option>
            <option value="title">{t('Iniziali Maiuscole')}</option>
          </select>
        )}
        <label className="check">
          <input type="checkbox" checked={includeExt} onChange={e => setIncludeExt(e.target.checked)} /> {t('Includi estensione')}
        </label>
        <div className="file-names">
          {pairs.map((p, i) => (
            <div key={p.from} className="row" title={`${p.from} → ${p.to}`}>
              <span className="path">{p.from}</span>
              <span>→</span>
              <span className="path">{p.to === p.from ? t('(invariato)') : p.to}</span>
              {errors[i] && <span className="error">{errors[i]}</span>}
            </div>
          ))}
        </div>
        <div className="actions">
          <button onClick={onClose}>{t('Annulla')}</button>
          <button className="primary" disabled={!ok} onClick={apply}>
            {t('Rinomina')}
          </button>
        </div>
      </div>
    </div>
  )
}
