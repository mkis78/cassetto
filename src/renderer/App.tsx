import { useEffect, useRef, useState } from 'react'
import { DockviewReact, themeDark, themeLight, type DockviewApi, type DockviewReadyEvent, type SerializedDockview } from 'dockview-react'
import type { AppState } from '../shared/types'
import FilesTile from './FilesTile'
import Tab, { NewTabButton } from './Tab'
import SshDialog from './SshDialog'
import Palette, { type Command } from './Palette'
import { Columns2, FolderOpen, Maximize2, Minimize2, PanelTopOpen, Server, Settings, SquareArrowLeft, SquareArrowRight, X } from 'lucide-react'
import SettingsDialog from './SettingsDialog'
import Welcome, { WelcomeContext, type WelcomeActions } from './Welcome'
import { closeTiles, cycleTile, focusTile, openFolder, tileActions, tileFolder } from './tiles'
import { applySettings, DEFAULT_SETTINGS, getSettings, useTheme } from './settings'

const components = { files: FilesTile }

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [sshDialog, setSshDialog] = useState(false)
  const [palette, setPalette] = useState<{ mode: 'files' | 'commands' | 'bar' } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const dv = useRef<DockviewApi | null>(null)
  const theme = useTheme() === 'light' ? themeLight : themeDark

  useEffect(() => void window.api.loadState().then(setState), [])
  useEffect(() => applySettings(state?.settings), [state?.settings])
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
  const pick = async () => {
    const path = await window.api.pickFolder()
    if (path && dv.current) openFolder(dv.current, { path, host: null })
  }
  const home = () => dv.current && openFolder(dv.current, { path: getSettings().filesHome ?? null, host: null })

  useEffect(() => {
    const cycle = (step: number) => cycleTile(dv.current ?? undefined, step)
    // captured before the lists see them: Cmd+P quick open, Cmd+Shift+P commands, Cmd+] Cmd+[ between tabs
    const keys = (e: KeyboardEvent) => {
      // Ctrl+Space: the action bar (ponytail: macOS may keep it for switching input source; then use the menu or rebind)
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Space') return void (e.preventDefault(), e.stopPropagation(), setPalette({ mode: 'bar' }))
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
    setTimeout(() => focusTile(api.activePanel), 50)
  }

  const welcome: WelcomeActions = { home, pick, ssh: () => setSshDialog(true) }
  const paletteActions = (): Command[] => {
    const p = active()
    const group = 'Generali'
    const general: Command[] = [
      { label: 'Nuovo tab', hint: 'Cmd+T', run: newTab, icon: PanelTopOpen },
      { label: 'Apri cartella…', run: pick, icon: FolderOpen },
      { label: 'Connetti a server SSH…', hint: 'Cmd+K', run: () => setSshDialog(true), icon: Server },
      ...(p && dv.current ? [{ label: 'Apri in un pannello a destra', run: () => openFolder(dv.current!, { path: (p.params as { path: string | null }).path, host: (p.params as { host: string | null }).host }, p.id, 'right'), icon: Columns2 }] : []),
      { label: 'Tab successivo', hint: 'Cmd+]', run: () => cycleTile(dv.current ?? undefined, 1), icon: SquareArrowRight },
      { label: 'Tab precedente', hint: 'Cmd+[', run: () => cycleTile(dv.current ?? undefined, -1), icon: SquareArrowLeft },
      ...(p ? [{ label: 'Chiudi tab', hint: 'Cmd+W', run: () => closeTiles([p]), icon: X }, { label: p.api.isMaximized() ? 'Ripristina pannello' : 'Massimizza pannello', run: () => (p.api.isMaximized() ? p.api.exitMaximized() : p.api.maximize()), icon: p.api.isMaximized() ? Minimize2 : Maximize2 }] : []),
      { label: 'Impostazioni…', hint: 'Cmd+,', run: () => setSettingsOpen(true), icon: Settings }
    ].map(c => ({ ...c, group }))
    // what the tab in front can do with its selection and its folder first
    return [...(p ? (tileActions(p.id)?.() ?? []) : []), ...general]
  }

  return (
    <div className={`app platform-${window.api.platform}`}>
      <div className="topbar">
        <div className="spacer" />
        <span className="version">{__VERSION__}</span>
      </div>
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
