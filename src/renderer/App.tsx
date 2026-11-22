import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { DockviewReact, themeDark, themeLight, type DockviewApi, type DockviewReadyEvent, type SerializedDockview } from 'dockview-react'
import type { AppState, Favourite, TileParams } from '../shared/types'
import type { UpdateStatus } from '../main/release'
import FilesTile from './FilesTile'
import TerminalTile from './TerminalTile'
import GitTile from './GitTile'
import { SET_MODULE, type ModuleId } from './modules'
import { destroyTerminal } from './terminals'
import Tab, { NewTabButton } from './Tab'
import SshDialog from './SshDialog'
import Palette, { type Command } from './Palette'
import Sidebar from './Sidebar'
import Transfers from './Transfers'
import { ChevronDown, SquareTerminal, Columns2, Columns3, FolderOpen, Grid2x2, LayoutPanelLeft, Rows2, Square, LayoutDashboard, Save, Maximize2, Minimize2, PanelLeft, PanelTopOpen, Server, Settings, SquareArrowLeft, SquareArrowRight, Undo2, X } from 'lucide-react'
import SettingsDialog from './SettingsDialog'
import Welcome, { WelcomeContext, type WelcomeActions } from './Welcome'
import { closeTiles, cycleTile, FAVOURITE, focusTile, openFolder, openTerminal, PLACE_DND, runUndo, tileActions, tileFolder, whereOf } from './tiles'
import { applySettings, DEFAULT_SETTINGS, getSettings, useTheme } from './settings'
import { DEFAULT_BAR, fromEvent, shortcutLabel } from '../shared/shortcuts'
import { layoutsMenu, putLayout } from '../shared/menus'
import { addFavourite, pushRecent } from '../shared/favourites'
import { arrange, PRESETS, type Layout, type Preset } from '../shared/arrange'
import { popup } from './menuIcons'
import { ICON } from './icons'
import { t, setLang, resolveLang } from '../shared/i18n'

// CodeMirror loads with the first editor tab, not with the app
const Editor = lazy(() => import('./EditorTile'))
const EditorTile = (props: React.ComponentProps<typeof Editor>) => (
  <Suspense fallback={<div className="files-empty">{t("Apro l'editor…")}</div>}>
    <Editor {...props} />
  </Suspense>
)
const components = { files: FilesTile, terminal: TerminalTile, editor: EditorTile, git: GitTile }

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [sshDialog, setSshDialog] = useState(false)
  const [palette, setPalette] = useState<{ mode: 'files' | 'commands' | 'bar' } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [undoLabel, setUndoLabel] = useState<string | null>(null) // asked for when the bar opens; paletteActions is synchronous
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  // a newer release, offered in the top bar; while it installs, a banner says how far it is
  const [newVersion, setNewVersion] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(null)
  useEffect(() => {
    const check = () => void window.api.checkUpdate().then(r => setNewVersion(r?.version ?? null))
    check()
    const t = setInterval(check, 6 * 3600_000)
    const offs = [window.api.onUpdateStatus(setUpdateStatus), window.api.onUpdateFound(setNewVersion)]
    return () => (clearInterval(t), offs.forEach(off => off()))
  }, [])
  const install = () => {
    if (!confirm(t("Aggiornare Cassetto alla versione {version}? L'app si chiude e si riapre: i terminali aperti vengono chiusi.", { version: newVersion ?? '' }))) return
    setUpdateStatus({ label: t('Avvio…'), progress: null }) // at once, before main reports the first step
    void window.api.installUpdate()
  }
  const [saving, setSaving] = useState(false) // the dialog that names the layout to save
  const [lastLayout, setLastLayout] = useState('') // the one opened or saved last: the name the save dialog offers
  const [conflict, setConflict] = useState<{ shortcut: string; with: string } | null>(null) // the bar's shortcut is taken by the system
  const dv = useRef<DockviewApi | null>(null)
  const theme = useTheme() === 'light' ? themeLight : themeDark

  // the language first: everything after is drawn in it
  // caches held by a renderer that reloaded go first: the restored tabs open their archives again
  useEffect(() => void Promise.all([window.api.loadState(), window.api.archiveReleaseAll()]).then(([s]) => (setLang(resolveLang(s.settings?.language, navigator.language)), setState(s))), [])
  useEffect(() => applySettings(state?.settings), [state?.settings])
  // a compartment switched on from a tile (modules.setModule) is saved like one switched in the dialog
  useEffect(() => {
    const h = (e: Event) => {
      const { id, on } = (e as CustomEvent<{ id: ModuleId; on: boolean }>).detail
      update(s => ({ ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings, modules: { ...s.settings?.modules, [id]: on } } }))
    }
    window.addEventListener(SET_MODULE, h)
    return () => window.removeEventListener(SET_MODULE, h)
  }, [])
  // at start and after each change: warn when macOS (or Raycast) keeps the bar's shortcut for itself
  useEffect(() => {
    if (palette?.mode === 'bar') window.api.undoLabel().then(setUndoLabel)
  }, [palette?.mode])
  // "Aggiungi ai preferiti" in a Files tile
  useEffect(() => {
    const f = (e: Event) => setState(s => s && { ...s, sidebar: { ...s.sidebar, favourites: addFavourite(s.sidebar?.favourites ?? [], (e as CustomEvent<Favourite>).detail) } })
    window.addEventListener(FAVOURITE, f)
    return () => window.removeEventListener(FAVOURITE, f)
  }, [])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const f = (e: Event) => (setToast((e as CustomEvent).detail), clearTimeout(timer), (timer = setTimeout(() => setToast(null), 3000)))
    window.addEventListener('cassetto:toast', f)
    return () => (window.removeEventListener('cassetto:toast', f), clearTimeout(timer))
  }, [])
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
  const toggleSidebar = () => setState(s => s && { ...s, sidebar: { ...s.sidebar, collapsed: !s.sidebar?.collapsed } })
  const home = () => dv.current && openFolder(dv.current, { path: getSettings().filesHome ?? null, host: null })

  useEffect(() => {
    const cycle = (step: number) => cycleTile(dv.current ?? undefined, step)
    // captured before the lists see them: Cmd+P quick open, Cmd+Shift+P commands, Cmd+] Cmd+[ between tabs
    const keys = (e: KeyboardEvent) => {
      if ((document.activeElement as HTMLElement | null)?.closest('[data-recording]')) return // a shortcut being set in Impostazioni
      // the action bar, Ctrl+Space unless changed; checked first, so it wins whatever it was set to
      if (fromEvent(e) === (getSettings().barShortcut ?? DEFAULT_BAR)) return void (e.preventDefault(), e.stopPropagation(), setPalette({ mode: 'bar' }))
      // Cmd+Alt+S (Ctrl+Alt+S on Linux): the sidebar, expanded or a rail
      if (e.code === 'KeyS' && e.altKey && !e.shiftKey && (window.api.platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) return void (e.preventDefault(), e.stopPropagation(), toggleSidebar())
      if (!(window.api.platform === 'darwin' ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey)) return
      const inEditor = !!(e.target as Element | null)?.closest?.('.cm-editor') // there Cmd+K belongs to the editor's chords
      const act = { KeyP: () => setPalette({ mode: window.api.platform === 'darwin' && e.shiftKey ? 'commands' : 'files' }), BracketRight: () => cycle(1), BracketLeft: () => cycle(-1), ...(!inEditor && !e.shiftKey && { KeyK: () => setSshDialog(true) }) }[e.code]
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
      window.api.onOpenPalette(mode => setPalette({ mode })),
      // from inside a tab (the editor's Cmd+R)
      (() => {
        const f = (e: Event) => setPalette({ mode: (e as CustomEvent<'bar' | 'commands' | 'files'>).detail })
        window.addEventListener('cassetto:palette', f)
        return () => window.removeEventListener('cassetto:palette', f)
      })()
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
    // a closed terminal tab ends its shell, a closed Files tab lets go of its archives; not one that comes straight back (fromJSON rebuilds every panel
    // for an arrangement or a saved layout, with the same ids)
    api.onDidRemovePanel(p => setTimeout(() => !api.getPanel(p.id) && (destroyTerminal(p.id), void window.api.archiveCancel(p.id), void window.api.archiveRelease(p.id))))
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
      alert(t('Il layout «{name}» non si può aprire: forse è di una versione diversa di Cassetto.', { name }))
    }
  }
  const deleteLayout = (name: string) => confirm(t('Eliminare il layout «{name}»?', { name })) && update(s => ({ ...s, layouts: (s.layouts ?? []).filter(l => l.name !== name) }))
  const layoutChoice = async (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    const arrangements = (Object.keys(PRESETS) as Preset[]).map(id => ({ id, label: t(PRESETS[id].label) }))
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

  // the folder of the Files tab in front, for the sidebar's highlight (the layout changes, and so this render, when it moves)
  const front = active()?.params as TileParams | undefined
  const activeFiles = front?.kind === 'files' ? whereOf(active()) : null // inside an archive: the folder holding it

  const welcome: WelcomeActions = { home, pick, ssh: () => setSshDialog(true) }
  const paletteActions = (): Command[] => {
    const p = active()
    const group = t('Generali')
    const general: Command[] = [
      ...(undoLabel ? [{ label: t('Annulla: {label}', { label: undoLabel }), hint: 'Cmd+Z', run: runUndo, icon: Undo2 }] : []),
      { label: t('Nuovo tab'), hint: 'Cmd+T', run: newTab, icon: PanelTopOpen },
      { label: t('Apri cartella…'), run: pick, icon: FolderOpen },
      { label: t('Nuovo terminale qui'), hint: 'Cmd+Alt+T', run: newTerminal, icon: SquareTerminal },
      { label: t('Connetti a server SSH…'), hint: 'Cmd+K', run: () => setSshDialog(true), icon: Server },
      ...(p && dv.current ? [{ label: t('Apri in un pannello a destra'), run: () => openFolder(dv.current!, whereOf(p), p.id, 'right'), icon: Columns2 }] : []),
      { label: t('Tab successivo'), hint: 'Cmd+]', run: () => cycleTile(dv.current ?? undefined, 1), icon: SquareArrowRight },
      { label: t('Tab precedente'), hint: 'Cmd+[', run: () => cycleTile(dv.current ?? undefined, -1), icon: SquareArrowLeft },
      ...(p ? [{ label: t('Chiudi tab'), hint: 'Cmd+W', run: () => closeTiles([p]), icon: X }, { label: p.api.isMaximized() ? t('Ripristina pannello') : t('Massimizza pannello'), run: () => (p.api.isMaximized() ? p.api.exitMaximized() : p.api.maximize()), icon: p.api.isMaximized() ? Minimize2 : Maximize2 }] : []),
      { label: state.sidebar?.collapsed ? t('Espandi barra laterale') : t('Comprimi barra laterale'), hint: 'Cmd+Alt+S', run: toggleSidebar, icon: PanelLeft },
      { label: t('Impostazioni…'), hint: 'Cmd+,', run: () => setSettingsOpen(true), icon: Settings }
    ].map(c => ({ ...c, group }))
    const arrangements: Command[] = (Object.keys(PRESETS) as Preset[]).map(k => ({ label: t('Disponi: {how}', { how: t(PRESETS[k].label).toLowerCase() }), run: () => arrangeTabs(k), icon: ARRANGE_ICON[k], group: t('Disposizione') }))
    const saved: Command[] = [
      { label: t('Salva layout corrente…'), run: () => setSaving(true), icon: Save },
      ...layouts.map(l => ({ label: t('Apri layout: {name}', { name: l.name }), run: () => openLayout(l.name), icon: LayoutDashboard }))
    ].map(c => ({ ...c, group: t('Layout') }))
    // what the tab in front can do with its selection and its folder first
    return [...(p ? (tileActions(p.id)?.() ?? []) : []), ...general, ...arrangements, ...saved]
  }

  return (
    <div className={`app platform-${window.api.platform}`}>
      <div className="topbar">
        <div className="spacer" />
        <Transfers />
        <button className="topbar-btn" title={t('Disposizione e layout salvati')} onClick={layoutChoice}>
          <LayoutDashboard {...ICON} /> {lastLayout || t('Layout')} <ChevronDown size={12} strokeWidth={2} />
        </button>
        <span className="version">{__VERSION__}</span>
        {newVersion && !updateStatus && (
          <button className="update" title={t('Scarica la nuova versione e riavvia')} onClick={install}>
            ↑ v{newVersion}
          </button>
        )}
      </div>
      {updateStatus && <UpdateBanner status={updateStatus} />}
      {conflict && state.settings?.ignoredConflict !== conflict.shortcut && !settingsOpen && (
        <div className="app-notice" role="alert">
          <span>{t('La barra azioni si apre con {keys}, ma macOS la usa già per «{what}» e non la passa a Cassetto.', { keys: shortcutLabel(conflict.shortcut), what: conflict.with })}</span>
          <button className="primary" onClick={() => setSettingsOpen(true)}>{t('Cambia scorciatoia')}</button>
          <button onClick={() => update(s => ({ ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings, ignoredConflict: conflict.shortcut } }))}>{t('Ignora')}</button>
        </div>
      )}
      <WelcomeContext.Provider value={welcome}>
        <div className="ws-row">
          <Sidebar tiles={state.settings?.favStyle === 'tiles'} state={state.sidebar ?? {}} onChange={sidebar => update(s => ({ ...s, sidebar }))} api={dv.current} activePath={activeFiles} onAllServers={() => setSshDialog(true)} />
          {/* a sidebar item dropped on a panel no Files tab took (another host, a terminal, an editor): a new Files tab */}
          <div className="ws-body" onDragOver={e => e.dataTransfer.types.includes(PLACE_DND) && e.preventDefault()} onDrop={e => {
            const raw = e.dataTransfer.getData(PLACE_DND)
            if (raw && dv.current) openFolder(dv.current, JSON.parse(raw))
          }}>
            <DockviewReact theme={theme} components={components} onReady={onReady} defaultRenderer="always" dndStrategy="pointer" defaultTabComponent={Tab} leftHeaderActionsComponent={NewTabButton} watermarkComponent={Welcome} />
          </div>
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
      {toast && <div className={'toast' + (toast.error ? ' error' : '')} role={toast.error ? 'alert' : 'status'}>{toast.text}</div>}
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
            update(s => ({ ...s, sidebar: { ...s.sidebar, recentHosts: pushRecent(s.sidebar?.recentHosts, host) } })) // the sidebar lists it from now on
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
  const save = () => n && (!replaces || n === initial || confirm(t('Esiste già un layout «{name}»: sostituirlo?', { name: n }))) && onSave(n)
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" onKeyDown={e => e.key === 'Escape' && onCancel()}>
        <h3>{t('Salva layout')}</h3>
        <label>{t('Nome')}</label>
        <input autoFocus value={name} placeholder={t('es. Progetto X')} onFocus={e => e.target.select()} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
        {replaces && <p className="path">{t('Sostituirà il layout salvato con questo nome.')}</p>}
        <div className="actions">
          <button onClick={onCancel}>{t('Annulla')}</button>
          <button className="primary" disabled={!n} onClick={save}>
            {t('Salva')}
          </button>
        </div>
      </div>
    </div>
  )
}

// an update in progress, across the window under the top bar: what it does, how far (when it can be measured)
function UpdateBanner({ status }: { status: NonNullable<UpdateStatus> }) {
  const pct = status.progress === null ? null : Math.round(status.progress * 100)
  return (
    <div className="update-banner" role="status">
      <span className="spinner" />
      <b>{t('Aggiornamento di Cassetto')}</b>
      <span className="label">{status.label}</span>
      <div className={'bar' + (pct === null ? ' indeterminate' : '')}>
        <div style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      <span className="pct">{pct === null ? '' : `${pct}%`}</span>
      <span className="hint">{t("Al termine l'app si riavvia")}</span>
    </div>
  )
}
