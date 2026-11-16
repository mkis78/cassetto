import { useEffect, useRef, useState } from 'react'
import { DockviewReact, themeDark, themeLight, type DockviewApi, type DockviewReadyEvent, type SerializedDockview } from 'dockview-react'
import type { AppState } from '../shared/types'
import FilesTile from './FilesTile'
import Tab, { NewTabButton } from './Tab'
import SshDialog from './SshDialog'
import Palette, { type Command } from './Palette'
import SettingsDialog from './SettingsDialog'
import Welcome, { WelcomeContext, type WelcomeActions } from './Welcome'
import { closeTiles, cycleTile, focusTile, openFolder, tileFolder } from './tiles'
import { applySettings, DEFAULT_SETTINGS, getSettings, useTheme } from './settings'

const components = { files: FilesTile }

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [sshDialog, setSshDialog] = useState(false)
  const [palette, setPalette] = useState<{ commands: boolean } | null>(null)
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
      if (!(window.api.platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey)) return
      const act = { KeyP: () => setPalette({ commands: window.api.platform === 'darwin' && e.shiftKey }), BracketRight: () => cycle(1), BracketLeft: () => cycle(-1) }[e.code]
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
      window.api.onOpenPalette(commands => setPalette({ commands }))
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
    return [
      { label: 'Nuovo tab', hint: 'Cmd+T', run: newTab },
      { label: 'Apri cartella…', run: pick },
      { label: 'Connetti a server SSH…', hint: 'Cmd+K', run: () => setSshDialog(true) },
      ...(p && dv.current ? [{ label: 'Apri in un pannello a destra', run: () => openFolder(dv.current!, { path: (p.params as { path: string | null }).path, host: (p.params as { host: string | null }).host }, p.id, 'right') }] : []),
      { label: 'Tab successivo', hint: 'Cmd+]', run: () => cycleTile(dv.current ?? undefined, 1) },
      { label: 'Tab precedente', hint: 'Cmd+[', run: () => cycleTile(dv.current ?? undefined, -1) },
      ...(p ? [{ label: 'Chiudi tab', hint: 'Cmd+W', run: () => closeTiles([p]) }, { label: p.api.isMaximized() ? 'Ripristina pannello' : 'Massimizza pannello', run: () => (p.api.isMaximized() ? p.api.exitMaximized() : p.api.maximize()) }] : []),
      { label: 'Impostazioni…', hint: 'Cmd+,', run: () => setSettingsOpen(true) }
    ]
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
      {palette && (
        <Palette
          commands={palette.commands}
          root={tileFolder(active())}
          actions={paletteActions()}
          onOpen={full => void window.api.openPath(full)}
          onClose={() => setPalette(null)}
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
