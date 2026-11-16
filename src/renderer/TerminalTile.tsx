import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { TerminalParams } from '../shared/types'
import { terminalMenu } from '../shared/menus'
import { popup } from './menuIcons'
import { closeTiles, openFolder } from './tiles'
import { attachTerminal, endFind, findInTerminal, focusTerminal, hasSelection, onFindResults, terminalAction } from './terminals'

// a shell in its own tab
export default function TerminalTile({ api, containerApi, params }: IDockviewPanelProps<TerminalParams>) {
  const ref = useRef<HTMLDivElement>(null)
  const id = api.id
  const [finding, setFinding] = useState(0) // 0: no search bar; counts Cmd+F presses so each one focuses it
  useEffect(() => attachTerminal(id, params, ref.current!, () => setFinding(f => f + 1)), [id])
  useEffect(() => {
    const d = api.onDidActiveChange(e => e.isActive && focusTerminal(id))
    return () => d.dispose()
  }, [id])

  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    const choice = await popup(terminalMenu({ hasSelection: hasSelection(id), platform: window.api.platform }))
    if (choice === 'copy' || choice === 'paste' || choice === 'selectAll' || choice === 'clear') return terminalAction(id, choice)
    if (choice === 'folder') return openFolder(containerApi, { path: params.cwd, host: params.host }, id)
    if (choice === 'find') return setFinding(f => f + 1)
    if (choice === 'close') closeTiles([containerApi.getPanel(id)!])
  }

  return (
    <div className="terminal-wrap">
      <div ref={ref} className="terminal-tile" onMouseDown={() => focusTerminal(id)} onContextMenu={onContextMenu} />
      {finding > 0 && <FindBar id={id} focusAgain={finding} onClose={() => (setFinding(0), endFind(id))} />}
    </div>
  )
}

// Cmd+F in a terminal: the text, found as you type; Enter next, Shift+Enter previous, Esc closes
function FindBar({ id, focusAgain, onClose }: { id: string; focusAgain: number; onClose: () => void }) {
  const [text, setText] = useState('')
  const [found, setFound] = useState<{ index: number; count: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => onFindResults(id, (index, count) => setFound({ index, count })), [id])
  useEffect(() => void (input.current?.focus(), input.current?.select()), [focusAgain])
  const find = (back = false) => findInTerminal(id, text, { back })
  return (
    <div className="term-find">
      <input
        ref={input}
        spellCheck={false}
        value={text}
        placeholder="Cerca nel terminale"
        onChange={e => (setText(e.target.value), findInTerminal(id, e.target.value, { typing: true }), !e.target.value && setFound(null))}
        onKeyDown={e => {
          if (e.key === 'Enter') find(e.shiftKey)
          else if (e.key === 'Escape') onClose()
          else return
          e.preventDefault()
        }}
      />
      <span className="count">{text && found ? (found.count ? `${found.index + 1}/${found.count}` : 'nessuno') : ''}</span>
      <button title="Precedente (Shift+Invio)" onClick={() => find(true)}>
        <ChevronUp size={14} />
      </button>
      <button title="Successivo (Invio)" onClick={() => find()}>
        <ChevronDown size={14} />
      </button>
      <button title="Chiudi (Esc)" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  )
}
