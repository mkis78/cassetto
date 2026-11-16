import { useEffect, useRef, useState } from 'react'
import { DockviewReact, themeDark, themeLight, type DockviewApi, type DockviewReadyEvent, type SerializedDockview } from 'dockview-react'
import type { AppState } from '../shared/types'
import FilesTile from './FilesTile'
import TerminalTile from './TerminalTile'
import { destroyTerminal } from './terminals'
import Tab, { NewTabButton } from './Tab'
import SshDialog from './SshDialog'
import Palette, { type Command } from './Palette'
import { ChevronDown, SquareTerminal, Columns2, Columns3, FolderOpen, Grid2x2, LayoutPanelLeft, Rows2, Square, LayoutDashboard, Save, Maximize2, Minimize2, PanelTopOpen, Server, Settings, SquareArrowLeft, SquareArrowRight, X } from 'lucide-react'
import SettingsDialog from './SettingsDialog'
import Welcome, { WelcomeContext, type WelcomeActions } from './Welcome'
import { closeTiles, cycleTile, focusTile, openFolder, openTerminal, tileActions, tileFolder, whereOf } from './tiles'
import { applySettings, DEFAULT_SETTINGS, getSettings, useTheme } from './settings'
import { DEFAULT_BAR, fromEvent, shortcutLabel } from '../shared/shortcuts'
import { layoutsMenu, putLayout } from '../shared/menus'
import { arrange, PRESETS, type Layout, type Preset } from '../shared/arrange'
import { popup } from './menuIcons'
import { ICON } from './icons'

const components = { files: FilesTile, terminal: TerminalTile }

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [sshDialog, setSshDialog] = useState(false)
  const [palette, setPalette] = useState<{ mode: 'files' | 'commands' | 'bar' } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [saving, setSaving] = useState(false) // the dialog that names the layout to save
  const [lastLayout, setLastLayout] = useState('') // the one opened or saved last: the name the save dialog offers
  const [conflict, setConflict] = useState<{ shortcut: string; with: string } | null>(null) // the bar's shortcut is taken by the system
  const dv = useRef<DockviewApi | null>(null)
  const theme = useTheme() === 'light' ? themeLight : themeDark

  useEffect(() => void window.api.loadState().then(setState), [])
  useEffect(() => applySettings(state?.settings), [state?.settings])
  // at start and after each change: warn when macOS (or Raycast) keeps the bar's shortcut for itself
  const bar = state?.settings?.barShortcut ?? DEFAULT_BAR
  useEffect(() => {
    if (!state) return
    let live = true
    window.api.shortcutConflict(bar).then(c => live && setConflict(c ? { shortcut: bar, with: c } : null))
    return () => void (live = false)
  }, [bar, !!state])
  useEffect(() => {
    if (!state) return
    const t = setTimeout(() => window.api.saveState(state), 500)
    const flush = () => window.api.saveState(state)
    window.addEventListener('beforeunload', flush)
    return () => {
      clearTimeout(t)
      window.removeEventListener('beforeunload', flush)
    }
  }, [state])

  const active = () => dv.current?.activePanel
  const newTab = () => dv.current && openFolder(dv.current, { path: tileFolder(active()) ?? getSettings().filesHome ?? null, host: null })
  // a terminal where the tab in front is (its folder, or the one its terminal started in), else in the base folder
  const newTerminal = () => {
    const w = whereOf(active())
    if (dv.current) openTerminal(dv.current, { cwd: w.path ?? getSettings().filesHome ?? window.api.homeDir(), host: w.host })
  }
  const pick = async () => {
    const path = await window.api.pickFolder()
    if (path && dv.current) openFolder(dv.current, { path, host: null })
  }
  const home = () => dv.current && openFolder(dv.current, { path: getSettings().filesHome ?? null, host: null })

  useEffect(() => {
    const cycle = (step: number) => cycleTile(dv.current ?? undefined, step)
    // captured before the lists see them: Cmd+P quick open, Cmd+Shift+P commands, Cmd+] Cmd+[ between tabs
    const keys = (e: KeyboardEvent) => {
      if ((document.activeElement as HTMLElement | null)?.closest('[data-recording]')) return // a shortcut being set in Impostazioni
      // the action bar, Ctrl+Space unless changed; checked first, so it wins whatever it was set to
      if (fromEvent(e) === (getSettings().barShortcut ?? DEFAULT_BAR)) return void (e.preventDefault(), e.stopPropagation(), setPalette({ mode: 'bar' }))
      if (!(window.api.platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey)) return
      const act = { KeyP: () => setPalette({ mode: window.api.platform === 'darwin' && e.shiftKey ? 'commands' : 'files' }), BracketRight: () => cycle(1), BracketLeft: () => cycle(-1) }[e.code]
      if (!act) return
      e.preventDefault()
      e.stopPropagation()
      act()
    }
    window.addEventListener('keydown', keys, true)
    // dropping files from outside must not navigate the window away
    const over = (e: DragEvent) => e.preventDefault()
    document.addEventListener('dragover', over)
    document.addEventListener('drop', over)
    const offs = [
      window.api.onOpenSettings(() => setSettingsOpen(true)),
      window.api.onOpenSsh(() => setSshDialog(true)),
      window.api.onNewTile(newTab),
      window.api.onNewTerminal(newTerminal),
      window.api.onCloseTile(() => {
        const p = active()
        if (p) closeTiles([p])
      }),
      window.api.onCycleTile(cycle),
      window.api.onOpenPalette(mode => setPalette({ mode }))
    ]
    return () => {
      window.removeEventListener('keydown', keys, true)
      document.removeEventListener('dragover', over)
      document.removeEventListener('drop', over)
      offs.forEach(off => off())
    }
  }, [])

  if (!state) return null
  const update = (f: (s: AppState) => AppState) => setState(s => (s ? f(s) : s))

  function onReady({ api }: DockviewReadyEvent) {
    dv.current = api
    if (state?.layout) {
      try {
        api.fromJSON(state.layout as SerializedDockview)
      } catch {
        api.clear() // ponytail: layout illeggibile, si riparte da vuoto
      }
    }
    if (!api.panels.length) openFolder(api, { path: getSettings().filesHome ?? null, host: null }) // first launch: the home
    api.onDidLayoutChange(() => update(s => ({ ...s, layout: api.toJSON() })))
    // a closed terminal tab ends its shell; not one that comes straight back (fromJSON rebuilds every panel
    // for an arrangement or a saved layout, with the same ids)
    api.onDidRemovePanel(p => setTimeout(() => !api.getPanel(p.id) && destroyTerminal(p.id)))
    setTimeout(() => focusTile(api.activePanel), 50)
  }

  // saved layouts: the tabs, their folders, views and places, under a name
  const layouts = state.layouts ?? []
  const saveLayout = (name: string) => {
    if (!dv.current) return
    const item = { name, layout: dv.current.toJSON() }
    update(s => ({ ...s, layouts: putLayout(s.layouts, item) }))
    setLastLayout(name)
  }
  const openLayout = (name: string) => {
    const l = layouts.find(x => x.name === name)
    if (!l || !dv.current) return
    try {
      dv.current.fromJSON(l.layout as SerializedDockview) // replaces what is open; the layout as it was stays saved
      setLastLayout(name)
      setTimeout(() => focusTile(dv.current?.activePanel), 50)
    } catch {
      alert(`Il layout «${name}» non si può aprire: forse è di una versione diversa di Cassetto.`)
    }
  }
  const deleteLayout = (name: string) => confirm(`Eliminare il layout «${name}»?`) && update(s => ({ ...s, layouts: (s.layouts ?? []).filter(l => l.name !== name) }))
  const layoutChoice = async (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    const arrangements = (Object.keys(PRESETS) as Preset[]).map(id => ({ id, label: PRESETS[id].label }))
    const choice = await popup(layoutsMenu(layouts.map(l => l.name), arrangements), { x: Math.round(r.left), y: Math.round(r.bottom + 2) })
    if (choice?.startsWith('arrange:')) arrangeTabs(choice.slice(8) as Preset)
    if (choice === 'save') setSaving(true)
    if (choice?.startsWith('layout:')) openLayout(choice.slice(7))
    if (choice?.startsWith('delete:')) deleteLayout(choice.slice(7))
  }

  // quick arrangements: the open tabs into 1, 2, 3 or 4 panels
  const ARRANGE_ICON: Record<Preset, typeof Square> = { one: Square, two: Columns2, stacked: Rows2, three: Columns3, mainSide: LayoutPanelLeft, grid: Grid2x2 }
  const arrangeTabs = (preset: Preset) => {
    const api = dv.current
    if (!api || !api.panels.length) return
    const active = api.activePanel?.id
    api.fromJSON(arrange(api.toJSON() as unknown as Layout, preset, active, () => crypto.randomUUID()) as unknown as SerializedDockview)
    setTimeout(() => focusTile(api.activePanel), 50)
  }

  const welcome: WelcomeActions = { home, pick, ssh: () => setSshDialog(true) }
  const paletteActions = (): Command[] => {
    const p = active()
    const group = 'Generali'
    const general: Command[] = [
      { label: 'Nuovo tab', hint: 'Cmd+T', run: newTab, icon: PanelTopOpen },
      { label: 'Apri cartella…', run: pick, icon: FolderOpen },
      { label: 'Nuovo terminale qui', hint: 'Cmd+Alt+T', run: newTerminal, icon: SquareTerminal },
      { label: 'Connetti a server SSH…', hint: 'Cmd+K', run: () => setSshDialog(true), icon: Server },
      ...(p && dv.current ? [{ label: 'Apri in un pannello a destra', run: () => openFolder(dv.current!, whereOf(p), p.id, 'right'), icon: Columns2 }] : []),
      { label: 'Tab successivo', hint: 'Cmd+]', run: () => cycleTile(dv.current ?? undefined, 1), icon: SquareArrowRight },
      { label: 'Tab precedente', hint: 'Cmd+[', run: () => cycleTile(dv.current ?? undefined, -1), icon: SquareArrowLeft },
      ...(p ? [{ label: 'Chiudi tab', hint: 'Cmd+W', run: () => closeTiles([p]), icon: X }, { label: p.api.isMaximized() ? 'Ripristina pannello' : 'Massimizza pannello', run: () => (p.api.isMaximized() ? p.api.exitMaximized() : p.api.maximize()), icon: p.api.isMaximized() ? Minimize2 : Maximize2 }] : []),
      { label: 'Impostazioni…', hint: 'Cmd+,', run: () => setSettingsOpen(true), icon: Settings }
    ].map(c => ({ ...c, group }))
    const arrangements: Command[] = (Object.keys(PRESETS) as Preset[]).map(k => ({ label: `Disponi: ${PRESETS[k].label.toLowerCase()}`, run: () => arrangeTabs(k), icon: ARRANGE_ICON[k], group: 'Disposizione' }))
    const saved: Command[] = [
      { label: 'Salva layout corrente…', run: () => setSaving(true), icon: Save },
      ...layouts.map(l => ({ label: `Apri layout: ${l.name}`, run: () => openLayout(l.name), icon: LayoutDashboard }))
    ].map(c => ({ ...c, group: 'Layout' }))
    // what the tab in front can do with its selection and its folder first
    return [...(p ? (tileActions(p.id)?.() ?? []) : []), ...general, ...arrangements, ...saved]
  }

  return (
    <div className={`app platform-${window.api.platform}`}>
      <div className="topbar">
        <div className="spacer" />
        <button className="topbar-btn" title="Disposizione e layout salvati" onClick={layoutChoice}>
          <LayoutDashboard {...ICON} /> {lastLayout || 'Layout'} <ChevronDown size={12} strokeWidth={2} />
        </button>
        <span className="version">{__VERSION__}</span>
      </div>
      {conflict && state.settings?.ignoredConflict !== conflict.shortcut && !settingsOpen && (
        <div className="app-notice" role="alert">
          <span>
            La barra azioni si apre con <b>{shortcutLabel(conflict.shortcut)}</b>, ma macOS la usa già per «{conflict.with}» e non la passa a Cassetto.
          </span>
          <button className="primary" onClick={() => setSettingsOpen(true)}>Cambia scorciatoia</button>
          <button onClick={() => update(s => ({ ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings, ignoredConflict: conflict.shortcut } }))}>Ignora</button>
        </div>
      )}
      <WelcomeContext.Provider value={welcome}>
        <div className="ws-body">
          <DockviewReact theme={theme} components={components} onReady={onReady} defaultRenderer="always" dndStrategy="pointer" defaultTabComponent={Tab} leftHeaderActionsComponent={NewTabButton} watermarkComponent={Welcome} />
        </div>
      </WelcomeContext.Provider>
      {/* closing goes back to the list first, so an action's own focus (a rename box) can take it after */}
      {palette && (
        <Palette
          mode={palette.mode}
          root={tileFolder(active())}
          actions={paletteActions()}
          onOpen={full => void window.api.openPath(full)}
          onClose={() => (setPalette(null), focusTile(active()))}
        />
      )}
      {settingsOpen && <SettingsDialog settings={{ ...DEFAULT_SETTINGS, ...state.settings }} onChange={settings => update(s => ({ ...s, settings }))} onClose={() => setSettingsOpen(false)} />}
      {saving && (
        <SaveLayoutDialog
          initial={lastLayout}
          taken={layouts.map(l => l.name)}
          onSave={name => (setSaving(false), saveLayout(name))}
          onCancel={() => setSaving(false)}
        />
      )}
      {sshDialog && (
        <SshDialog
          onPick={host => {
            setSshDialog(false)
            if (dv.current) openFolder(dv.current, { path: null, host })
          }}
          onCancel={() => setSshDialog(false)}
        />
      )}
    </div>
  )
}

// the name to save the open tabs under; a taken name asks before replacing that layout
function SaveLayoutDialog({ initial, taken, onSave, onCancel }: { initial: string; taken: string[]; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial)
  const n = name.trim()
  const replaces = taken.includes(n)
  const save = () => n && (!replaces || n === initial || confirm(`Esiste già un layout «${n}»: sostituirlo?`)) && onSave(n)
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" onKeyDown={e => e.key === 'Escape' && onCancel()}>
        <h3>Salva layout</h3>
        <label>Nome</label>
        <input autoFocus value={name} placeholder="es. Progetto X" onFocus={e => e.target.select()} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
        {replaces && <p className="path">Sostituirà il layout salvato con questo nome.</p>}
        <div className="actions">
          <button onClick={onCancel}>Annulla</button>
          <button className="primary" disabled={!n} onClick={save}>
            Salva
          </button>
        </div>
      </div>
    </div>
  )
}
