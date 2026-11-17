import { useState } from 'react'
import { X } from 'lucide-react'
import { COLOR_NAMES, FINDER_TAGS, type Tag } from '../shared/tags'

// Apple's system colours, as the Finder paints its tags (index 0: no colour, a ring)
export const TAG_HEX = ['', '#8e8e93', '#34c759', '#af52de', '#007aff', '#ffcc00', '#ff3b30', '#ff9500']

// overlapping dots after a name, like the Finder; the names in the tooltip
export function TagDots({ tags }: { tags?: Tag[] }) {
  if (!tags?.length) return null
  return (
    <span className="tag-dots" title={tags.map(t => t.name).join(', ')}>
      {tags.slice(0, 4).map(t => (
        <span key={t.name} className={'tag-dot' + (t.color ? '' : ' none')} style={t.color ? { background: TAG_HEX[t.color] } : undefined} />
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
      <button title={`Togli ${tag.name}`} onClick={onRemove}>
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
  const pick = (v: string) => (setName(v), setColor(known.find(t => t.name.toLowerCase() === v.trim().toLowerCase())?.color ?? color))
  const suggestions = known.filter(t => !current.some(c => c.name === t.name) && (!n || t.name.toLowerCase().includes(n.toLowerCase()))).slice(0, 12)
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="dialog tag-dialog" onKeyDown={e => e.key === 'Escape' && onClose()}>
        <h3>Tag {count > 1 ? `di ${count} elementi` : ''}</h3>
        <div className="tag-list">
          {current.length ? current.map(t => <TagChip key={t.name} tag={t} onRemove={() => onApply({ remove: [t.name] })} />) : <span className="path">Nessun tag</span>}
        </div>
        <label>Aggiungi</label>
        <div className="row">
          <input autoFocus spellCheck={false} value={name} placeholder="Nome del tag, es. Lavoro" onChange={e => pick(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <button className="primary" disabled={!n} onClick={add}>
            Aggiungi
          </button>
        </div>
        <div className="tag-colors" role="radiogroup" aria-label="Colore">
          {COLOR_NAMES.map((c, i) => (
            <button key={c} role="radio" aria-checked={color === i} title={c} className={'tag-dot big' + (i ? '' : ' none') + (color === i ? ' on' : '')} style={i ? { background: TAG_HEX[i] } : undefined} onClick={() => setColor(i)} />
          ))}
          <span className="path">{COLOR_NAMES[color]}</span>
        </div>
        {suggestions.length > 0 && (
          <div className="tag-list">
            {suggestions.map(t => (
              <button key={t.name} className="tag-suggest" onClick={() => onApply({ add: [t] })}>
                <TagChip tag={t} />
              </button>
            ))}
          </div>
        )}
        <div className="actions">
          <button className="primary" onClick={onClose}>
            Fatto
          </button>
        </div>
      </div>
    </div>
  )
}

// the Finder's seven first, then any other tag seen here
export const knownTags = (seen: Tag[]): Tag[] => {
  const out = [...FINDER_TAGS]
  for (const t of seen) if (!out.some(k => k.name === t.name)) out.push(t)
  return out
}
