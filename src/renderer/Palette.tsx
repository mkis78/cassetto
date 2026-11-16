import { useEffect, useRef, useState } from 'react'
import { rank } from '../shared/fuzzy'
import { listKey } from '../shared/listNav'

export interface Command {
  label: string
  hint?: string
  run: () => void
}

type Row = { label: string; hint?: string; at: number[]; go: () => void }

// Quick open and command palette in one box, as in VS Code: files of the project around `root`,
// or commands when the text starts with ">" (or when there is no folder to look in)
export default function Palette(p: { commands: boolean; root: string | null; actions: Command[]; onOpen: (full: string) => void; onClose: () => void }) {
  const [text, setText] = useState(p.commands || !p.root ? '>' : '')
  const [project, setProject] = useState<{ root: string; files: string[]; truncated: boolean } | null>(null)
  const [cur, setCur] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => void (p.root && window.api.listFiles(p.root).then(setProject)), [p.root])
  useEffect(() => setCur(0), [text])
  useEffect(() => void listRef.current?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }), [cur])

  const commands = text.startsWith('>')
  const q = commands ? text.slice(1) : text
  const rows: Row[] = commands
    ? rank(q, p.actions, a => a.label).map(({ item, match }) => ({ label: item.label, hint: item.hint, at: match.at, go: item.run }))
    : rank(q, project?.files ?? [], f => f).map(({ item, match }) => ({ label: item, at: match.at, go: () => p.onOpen(`${project!.root.replace(/\/$/, '')}/${item}`) }))

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
          placeholder={p.root ? 'Cerca un file per nome · > per i comandi' : 'Cerca un comando'}
          onChange={e => setText(e.target.value)}
          onKeyDown={keys}
        />
        <div ref={listRef} className="palette-list">
          {rows.map((r, i) => (
            <div key={r.label + i} className={'palette-row' + (i === cur ? ' sel' : '')} onMouseMove={() => setCur(i)} onClick={() => go(r)}>
              <span className="label">{marked(r.label, r.at)}</span>
              {r.hint && <span className="hint">{r.hint}</span>}
            </div>
          ))}
          {!commands && !project && <div className="palette-empty">Leggo i file del progetto…</div>}
          {!rows.length && (commands || project) && <div className="palette-empty">Nessun risultato</div>}
          {!commands && project?.truncated && <div className="palette-empty">Progetto molto grande: cerco tra i primi {project.files.length} file</div>}
        </div>
      </div>
    </div>
  )
}
