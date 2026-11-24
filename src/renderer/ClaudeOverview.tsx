import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { DockviewApi } from 'dockview-react'
import { Asterisk } from 'lucide-react'
import { needsAttention, overviewOrder, type ClaudeState } from '../shared/claudeState'
import { t } from '../shared/i18n'
import type { ClaudeParams } from '../shared/types'
import { claudeStore, subscribe } from './claudeStore'
import { useMenuKeys } from './menuKeys'

const LABEL: Record<ClaudeState, string> = { idle: 'in pausa', working: 'lavora', waiting: 'ti aspetta', done: 'finito' }

// Every Claude tab of every workspace at a glance, from the top bar: what each is doing, a click to go there
export default function ClaudeOverview(p: { apis: DockviewApi[]; onReveal: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useMenuKeys(ref, open, () => setOpen(false))
  useEffect(() => {
    const f = () => setOpen(true) // the palette command
    window.addEventListener('cassetto:claude-overview', f)
    return () => window.removeEventListener('cassetto:claude-overview', f)
  }, [])
  const tabs = p.apis.flatMap(a => a.panels).filter(x => x.api.component === 'claude')
  // a string snapshot: the store hands out fresh Maps, which useSyncExternalStore would take for a change every time
  const snap = useSyncExternalStore(subscribe, () => tabs.map(x => claudeStore.get(x.id)).join(','))
  useEffect(() => void (open && !tabs.length && setOpen(false))) // asked from the palette with no Claude open
  if (!tabs.length) return null
  const states = snap.split(',')
  const rows = overviewOrder(tabs.map((x, i) => ({ id: x.id, state: states[i] as ClaudeState, cwd: (x.params as ClaudeParams).cwd, title: (x.params as ClaudeParams).name ?? x.title ?? 'Claude' })))
  const waiting = rows.filter(r => r.state === 'waiting').length
  const working = rows.filter(r => r.state === 'working').length
  return (
    <div className="claude-overview">
      <button className={'topbar-btn' + (rows.some(r => needsAttention(r.state)) ? ' waiting' : '')} title={t('Panoramica dei Claude')} onClick={() => setOpen(!open)}>
        <Asterisk size={14} strokeWidth={1.75} /> {rows.length}
        {working > 0 && <span className="dot working" title={t('{n} al lavoro', { n: working })} />}
        {waiting > 0 && <span className="badge">{waiting}</span>}
      </button>
      {open && (
        <div ref={ref} className="menu claude-list" onMouseLeave={() => setOpen(false)}>
          {rows.map(r => (
            <div key={r.id} onClick={() => (setOpen(false), p.onReveal(r.id))} title={r.cwd}>
              <span className={'dot ' + r.state} />
              <span className="title">{r.title}</span>
              <span className="state">{t(LABEL[r.state])}</span>
              <span className="ws">{r.cwd.split('/').filter(Boolean).pop() || '/'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
