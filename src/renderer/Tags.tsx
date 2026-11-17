import { useState } from 'react'
import { X } from 'lucide-react'
import { COLOR_NAMES, FINDER_TAGS, type Tag } from '../shared/tags'
import { t } from '../shared/i18n'

// Apple's system colours, as the Finder paints its tags (index 0: no colour, a ring)
export const TAG_HEX = ['', '#8e8e93', '#34c759', '#af52de', '#007aff', '#ffcc00', '#ff3b30', '#ff9500']

// overlapping dots after a name, like the Finder; the names in the tooltip
export function TagDots({ tags }: { tags?: Tag[] }) {
  if (!tags?.length) return null
  return (
    <span className="tag-dots" title={tags.map(x => x.name).join(', ')}>
      {tags.slice(0, 4).map(x => (
        <span key={x.name} className={'tag-dot' + (x.color ? '' : ' none')} style={x.color ? { background: TAG_HEX[x.color] } : undefined} />
      ))}
    </span>
  )
}

// a tag as a little label: colour and name
export const TagChip = ({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) => (
  <span className="tag-chip">
    <span className={'tag-dot' + (tag.color ? '' : ' none')} style={tag.color ? { background: TAG_HEX[tag.color] } : undefined} />
    {tag.name}
    {onRemove && (
      <button title={t('Togli {name}', { name: tag.name })} onClick={onRemove}>
        <X size={11} strokeWidth={2} />
      </button>
    )}
  </span>
)

// the tags of the selected items: the ones they carry (all or some of them), new ones by name and colour
export function TagDialog({ count, current, known, onApply, onClose }: { count: number; current: Tag[]; known: Tag[]; onApply: (c: { add?: Tag[]; remove?: string[] }) => void; onClose: () => void }) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(0)
  const n = name.trim()
  const add = () => n && (onApply({ add: [{ name: n, color }] }), setName(''))
  // a known name brings its colour along, so "Lavoro" stays the colour it already has elsewhere
  const pick = (v: string) => (setName(v), setColor(known.find(x => x.name.toLowerCase() === v.trim().toLowerCase())?.color ?? color))
  const suggestions = known.filter(x => !current.some(c => c.name === x.name) && (!n || x.name.toLowerCase().includes(n.toLowerCase()))).slice(0, 12)
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog tag-dialog" onKeyDown={e => e.key === 'Escape' && onClose()}>
        <h3>{count > 1 ? t('Tag di {n} elementi', { n: count }) : t('Tag')}</h3>
        <div className="tag-list">
          {current.length ? current.map(x => <TagChip key={x.name} tag={x} onRemove={() => onApply({ remove: [x.name] })} />) : <span className="path">{t('Nessun tag')}</span>}
        </div>
        <label>{t('Aggiungi')}</label>
        <div className="row">
          <input autoFocus spellCheck={false} value={name} placeholder={t('Nome del tag, es. Lavoro')} onChange={e => pick(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <button className="primary" disabled={!n} onClick={add}>
            {t('Aggiungi')}
          </button>
        </div>
        <div className="tag-colors" role="radiogroup" aria-label={t('Colore')}>
          {COLOR_NAMES.map((c, i) => (
            <button key={c} role="radio" aria-checked={color === i} title={t(c)} className={'tag-dot big' + (i ? '' : ' none') + (color === i ? ' on' : '')} style={i ? { background: TAG_HEX[i] } : undefined} onClick={() => setColor(i)} />
          ))}
          <span className="path">{t(COLOR_NAMES[color])}</span>
        </div>
        {suggestions.length > 0 && (
          <div className="tag-list">
            {suggestions.map(x => (
              <button key={x.name} className="tag-suggest" onClick={() => onApply({ add: [x] })}>
                <TagChip tag={x} />
              </button>
            ))}
          </div>
        )}
        <div className="actions">
          <button className="primary" onClick={onClose}>
            {t('Fatto')}
          </button>
        </div>
      </div>
    </div>
  )
}

// the Finder's seven first, then any other tag seen here
export const knownTags = (seen: Tag[]): Tag[] => {
  // the Finder's own names in the language in use (an English Finder colours "Red", an Italian one "Rosso")
  const out = FINDER_TAGS.map(x => ({ ...x, name: t(x.name) }))
  for (const x of seen) if (!out.some(k => k.name === x.name)) out.push(x)
  return out
}
