import { Fragment, useEffect, useRef, useState } from 'react'
import { rank } from '../shared/fuzzy'
import { listKey } from '../shared/listNav'
import { File, type LucideIcon } from 'lucide-react'
import { ICON } from './icons'

export interface Command {
  label: string
  hint?: string
  run: () => void
  icon?: LucideIcon
  group?: string // the action bar shows commands under these headings, in the order they come
}

type Row = { label: string; hint?: string; at: number[]; go: () => void; icon?: LucideIcon; group?: string }

// most files the action bar lists under the commands
const BAR_FILES = 30

// Quick open and command palette in one box, as in VS Code: files of the project around `root`,
// or commands when the text starts with ">" (or when there is no folder to look in).
// mode 'bar' is the action bar (Ctrl+Space): commands by group, then the files that match, like Raycast.
export default function Palette(p: { mode: 'files' | 'commands' | 'bar'; root: string | null; actions: Command[]; onOpen: (full: string) => void; onClose: () => void }) {
  const bar = p.mode === 'bar'
  const [text, setText] = useState(p.mode === 'commands' || (!bar && !p.root) ? '>' : '')
  const [project, setProject] = useState<{ root: string; files: string[]; truncated: boolean } | null>(null)
  const [cur, setCur] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => void (p.root && window.api.listFiles(p.root).then(setProject)), [p.root])
  useEffect(() => setCur(0), [text])
  useEffect(() => void listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }), [cur])

  const commands = bar || text.startsWith('>')
  const q = bar ? text : commands ? text.slice(1) : text
  const commandRows = (): Row[] => {
    const ranked = rank(q, p.actions, a => a.label).map(({ item, match }) => ({ label: item.label, hint: item.hint, at: match.at, go: item.run, icon: item.icon, group: item.group }))
    if (!bar) return ranked
    const order = [...new Set(p.actions.map(a => a.group))] // the groups stay together, best match first within each
    return order.flatMap(g => ranked.filter(r => r.group === g))
  }
  const fileRows = (): Row[] =>
    rank(q, project?.files ?? [], f => f).map(({ item, match }) => ({ label: item, at: match.at, icon: File, group: 'File', go: () => p.onOpen(`${project!.root.replace(/\/$/, '')}/${item}`) }))
  const rows: Row[] = bar ? [...commandRows(), ...(q ? fileRows().slice(0, BAR_FILES) : [])] : commands ? commandRows() : fileRows()

  const go = (r: Row | undefined) => {
    if (!r) return
    p.onClose()
    r.go()
  }
  const keys = (e: React.KeyboardEvent) => {
    const i = listKey(e.key, cur, rows.length)
    if (i !== null) setCur(i)
    else if (e.key === 'Enter') go(rows[cur])
    else if (e.key === 'Escape') p.onClose()
    else return
    e.preventDefault()
  }
  const marked = (s: string, at: number[]) => {
    const set = new Set(at)
    return [...s].map((c, i) => (set.has(i) ? <mark key={i}>{c}</mark> : c))
  }

  return (
    <div className="overlay palette-overlay" onMouseDown={e => e.target === e.currentTarget && p.onClose()}>
      <div className="palette">
        <input
          autoFocus
          spellCheck={false}
          value={text}
          placeholder={bar ? 'Cerca un\'azione o un file…' : p.root ? 'Cerca un file per nome · > per i comandi' : 'Cerca un comando'}
          onChange={e => setText(e.target.value)}
          onKeyDown={keys}
        />
        <div ref={listRef} className="palette-list">
          {rows.map((r, i) => (
            <Fragment key={r.label + i}>
              {bar && r.group && r.group !== rows[i - 1]?.group && <div className="palette-group">{r.group}</div>}
              <div className={'palette-row' + (i === cur ? ' sel' : '')} onMouseMove={() => setCur(i)} onClick={() => go(r)}>
                {bar && r.icon && <r.icon {...ICON} className="palette-icon" />}
                <span className="label">{marked(r.label, r.at)}</span>
                {r.hint && <span className="hint">{r.hint}</span>}
              </div>
            </Fragment>
          ))}
          {!commands && !project && <div className="palette-empty">Leggo i file del progetto…</div>}
          {!rows.length && (commands || project) && <div className="palette-empty">Nessun risultato</div>}
          {!commands && project?.truncated && <div className="palette-empty">Progetto molto grande: cerco tra i primi {project.files.length} file</div>}
        </div>
      </div>
    </div>
  )
}
