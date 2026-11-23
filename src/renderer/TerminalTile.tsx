import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { ClaudeParams, TerminalParams } from '../shared/types'
import { terminalMenu } from '../shared/menus'
import { popup } from './menuIcons'
import { closeTiles, openEditor, openFolder } from './tiles'
import { attachTerminal, destroyTerminal, endFind, findInTerminal, focusTerminal, hasSelection, isTerminal, onFindResults, restartTerminal, terminalAction } from './terminals'
import { setModule, useModule } from './modules'
import { t } from '../shared/i18n'

// a Claude Code session: a terminal running claude (or cswap); nothing spawns while the compartment is off or claude is missing
export function ClaudeTile(props: IDockviewPanelProps<ClaudeParams>) {
  const on = useModule('claude')
  // already running: a remount, no need to ask. 'cswap': an account is set but cswap is missing
  const [found, setFound] = useState<boolean | 'cswap' | null>(() => isTerminal(props.api.id) || null)
  useEffect(() => {
    // turned off: Claude stops (no work, no notifications); turned on again, the tab remounts and resumes
    if (!on) return void (isTerminal(props.api.id) && destroyTerminal(props.api.id), setFound(null))
    if (found === null) check(false)
  }, [on])
  const check = (fresh: boolean) => void window.api.claudeTools(fresh).then(x => setFound(!x.claude ? false : props.params.account && !x.cswap ? 'cswap' : true))
  // installed meanwhile: Riprova reads the PATH again, no restart needed
  const retry = <button onClick={() => (setFound(null), check(true))}>{t('Riprova')}</button>
  if (!on)
    return (
      <div className="files-empty">
        {t('Lo scomparto Claude Code è disattivato')} <button onClick={() => setModule('claude', true)}>{t('Attiva')}</button>
      </div>
    )
  if (found === false) return <div className="files-empty">{t('Claude Code non trovato: installalo con «curl -fsSL https://claude.ai/install.sh | bash», poi premi Riprova.')} {retry}</div>
  if (found === 'cswap') return <div className="files-empty">{t('Questo tab usa un account di cswap, ma cswap non è installato.')} {retry}</div>
  return found ? <TerminalTile {...props} /> : null
}

// a shell (or a Claude) in its own tab
export default function TerminalTile({ api, containerApi, params }: IDockviewPanelProps<TerminalParams | ClaudeParams>) {
  const ref = useRef<HTMLDivElement>(null)
  const id = api.id
  const [finding, setFinding] = useState(0) // 0: no search bar; counts Cmd+F presses so each one focuses it
  // the params of this render, for callbacks of the mount effect below (api.getParameters() can come back without them)
  const latest = useRef(params)
  latest.current = params
  useEffect(() => {
    // once launched, the next start resumes: a second --session-id with the same id is refused by claude, while a session
    // closed before its first message comes back as "No conversation found" and the fallback below starts a new one
    const markStarted = (p: TerminalParams | ClaudeParams) => p.kind === 'claude' && !p.started && api.updateParameters({ ...p, started: true })
    const detach = attachTerminal(id, params, ref.current!, {
      onFind: () => setFinding(f => f + 1),
      onLink: (path, line) => openEditor(containerApi, { path, host: params.kind === 'terminal' ? params.host : null, line }, id),
      // a resumed session claude no longer has: a new one in the same tab
      onFallback: () => {
        const fresh = { ...(latest.current as ClaudeParams), sessionId: crypto.randomUUID(), started: false }
        restartTerminal(id, fresh, t('Sessione precedente non trovata, ne apro una nuova'))
        markStarted(fresh)
      }
    })
    markStarted(params)
    return detach
  }, [id])
  useEffect(() => {
    const d = api.onDidActiveChange(e => e.isActive && focusTerminal(id))
    return () => d.dispose()
  }, [id])

  const onContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    const choice = await popup(terminalMenu({ hasSelection: hasSelection(id), platform: window.api.platform }))
    if (choice === 'copy' || choice === 'paste' || choice === 'selectAll' || choice === 'clear') return terminalAction(id, choice)
    if (choice === 'folder') return openFolder(containerApi, { path: params.cwd, host: params.kind === 'terminal' ? params.host : null }, id)
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
        placeholder={t('Cerca nel terminale')}
        onChange={e => (setText(e.target.value), findInTerminal(id, e.target.value, { typing: true }), !e.target.value && setFound(null))}
        onKeyDown={e => {
          if (e.key === 'Enter') find(e.shiftKey)
          else if (e.key === 'Escape') onClose()
          else return
          e.preventDefault()
        }}
      />
      <span className="count">{text && found ? (found.count ? `${found.index + 1}/${found.count}` : t('nessuno')) : ''}</span>
      <button title={t('Precedente (Shift+Invio)')} onClick={() => find(true)}>
        <ChevronUp size={14} />
      </button>
      <button title={t('Successivo (Invio)')} onClick={() => find()}>
        <ChevronDown size={14} />
      </button>
      <button title={t('Chiudi (Esc)')} onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  )
}
