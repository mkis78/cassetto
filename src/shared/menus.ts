// Context menus as data: the renderer builds them, main shows them natively and returns the chosen id.

export interface MenuItem {
  id?: string
  label: string
  enabled?: boolean
  accelerator?: string
  separator?: boolean
  submenu?: MenuItem[]
  dot?: string // #rrggbb: a coloured dot as the item's icon
  hollow?: boolean // the dot as a ring ("no colour")
  checked?: boolean // a tick: set, even to false, makes it a checkbox item
  image?: string // data:image/png;base64 at 2x, the item's icon (set by the renderer, see menuIcons)
}

export const TAB_COLORS = ['red', 'yellow', 'green', 'teal', 'blue', 'purple'] as const
export type TabColor = (typeof TAB_COLORS)[number]
export const COLOR_NAMES: Record<TabColor, string> = { red: 'Rosso', yellow: 'Giallo', green: 'Verde', teal: 'Verde acqua', blue: 'Blu', purple: 'Viola' }
// anything outside the palette (an old or hand-edited state.json) is no colour
export const tabColor = (v: unknown): TabColor | undefined => (TAB_COLORS.includes(v as TabColor) ? (v as TabColor) : undefined)

export const shortcut = (key: string, platform: string): string => (platform === 'darwin' ? `CmdOrCtrl+${key}` : `Ctrl+Shift+${key}`)

const sep: MenuItem = { label: '', separator: true }

// count: entries selected; paste: what the internal clipboard holds ('other-host': copied on another host, null: nothing)
export function filesMenu(c: { target: 'file' | 'dir' | 'background'; remote: boolean; count?: number; paste?: 'ok' | 'other-host' | null }): MenuItem[] {
  const create = [
    sep,
    { id: 'newFile', label: 'Nuovo file' },
    { id: 'newFolder', label: 'Nuova cartella' },
    { id: 'paste', label: c.paste === 'other-host' ? 'Incolla (solo dallo stesso host)' : 'Incolla', enabled: c.paste === 'ok' }
  ]
  const edit = [
    sep,
    { id: 'rename', label: 'Rinomina', enabled: (c.count ?? 1) === 1 },
    { id: 'duplicate', label: 'Duplica' },
    { id: 'copy', label: 'Copia' },
    { id: 'cut', label: 'Taglia' },
    sep,
    { id: 'delete', label: c.remote ? 'Elimina definitivamente…' : 'Sposta nel Cestino' }
  ]
  const split = [sep, { id: 'split:right', label: 'Apri in un pannello a destra' }, { id: 'split:within', label: 'Apri in un nuovo tab' }, { id: 'terminal', label: 'Apri terminale qui' }]
  if (c.target === 'file') return [{ id: 'open', label: 'Apri' }, { id: 'copyPath', label: 'Copia percorso' }, ...edit]
  if (c.target === 'dir') return [{ id: 'open', label: 'Apri' }, ...split, { id: 'copyPath', label: 'Copia percorso' }, ...create, ...edit]
  return [{ id: 'refresh', label: 'Aggiorna' }, { id: 'terminal', label: 'Apri terminale qui' }, ...create]
}

// a terminal tab
export function terminalMenu(c: { hasSelection: boolean; platform: string }): MenuItem[] {
  return [
    { id: 'copy', label: 'Copia', accelerator: shortcut('C', c.platform), enabled: c.hasSelection },
    { id: 'paste', label: 'Incolla', accelerator: shortcut('V', c.platform) },
    { id: 'selectAll', label: 'Seleziona tutto' },
    { id: 'find', label: 'Cerca…', accelerator: shortcut('F', c.platform) },
    { id: 'clear', label: 'Pulisci' },
    sep,
    { id: 'folder', label: 'Apri la cartella in un tab' },
    sep,
    { id: 'close', label: 'Chiudi tab', accelerator: shortcut('W', c.platform) }
  ]
}

// the files tile's "Vista" button: how the folder is drawn, what shows
export function viewMenu(c: { view: 'list' | 'icons' | 'columns' | 'gallery'; hidden: boolean; preview: boolean }): MenuItem[] {
  const views = [['list', 'Elenco'], ['icons', 'Icone'], ['columns', 'Colonne'], ['gallery', 'Galleria']] as const
  return [
    ...views.map(([id, label]) => ({ id: `view:${id}`, label, checked: c.view === id })),
    sep,
    { id: 'hidden', label: 'Mostra file nascosti', checked: c.hidden },
    { id: 'preview', label: 'Anteprima', accelerator: 'Space', checked: c.preview, enabled: c.view !== 'gallery' } // the gallery has its own
  ]
}

// the files tile's "Azioni" button: on the folder shown
export function actionsMenu(c: { ready: boolean; paste: 'ok' | 'other-host' | null }): MenuItem[] {
  return [
    { id: 'newFile', label: 'Nuovo file', enabled: c.ready },
    { id: 'newFolder', label: 'Nuova cartella', enabled: c.ready },
    { id: 'terminal', label: 'Apri terminale qui', enabled: c.ready },
    { id: 'paste', label: c.paste === 'other-host' ? 'Incolla (solo dallo stesso host)' : 'Incolla', enabled: c.ready && c.paste === 'ok' },
    sep,
    { id: 'refresh', label: 'Aggiorna' }
  ]
}

// a search hit: `line` when it comes from a content search
export function searchMenu(c: { line: boolean }): MenuItem[] {
  return [
    { id: 'open', label: 'Apri' },
    { id: 'copyPath', label: c.line ? 'Copia percorso:riga' : 'Copia percorso' },
    sep,
    { id: 'folder', label: 'Apri cartella' }
  ]
}

// dots: each colour's hex in the current theme, read from the CSS by the renderer
export function tabMenu(c: { maximized: boolean; others: boolean; color?: TabColor; named?: boolean; dots?: Partial<Record<TabColor | 'none', string>> }): MenuItem[] {
  return [
    { id: 'rename', label: 'Rinomina…' },
    ...(c.named ? [{ id: 'unname', label: 'Usa il nome della cartella' }] : []),
    {
      label: 'Colore',
      submenu: [
        { id: 'color:', label: (c.color ? '' : '✓ ') + 'Nessuno', dot: c.dots?.none, hollow: true },
        ...TAB_COLORS.map(k => ({ id: `color:${k}`, label: (c.color === k ? '✓ ' : '') + COLOR_NAMES[k], dot: c.dots?.[k] }))
      ]
    },
    sep,
    c.maximized ? { id: 'restore', label: 'Ripristina' } : { id: 'maximize', label: 'Massimizza' },
    { id: 'close', label: 'Chiudi tab' },
    { id: 'closeOthers', label: 'Chiudi gli altri tab', enabled: c.others }
  ]
}

// the top bar's "Layout" button: arrange the open tabs, save them, reopen or delete a saved layout (ids carry the name)
export function layoutsMenu(names: string[], arrangements: { id: string; label: string }[] = []): MenuItem[] {
  return [
    ...arrangements.map(a => ({ id: `arrange:${a.id}`, label: a.label })),
    ...(arrangements.length ? [sep] : []),
    { id: 'save', label: 'Salva layout corrente…' },
    ...(names.length
      ? [
          sep,
          ...names.map(n => ({ id: `layout:${n}`, label: n })),
          sep,
          { label: 'Elimina', submenu: names.map(n => ({ id: `delete:${n}`, label: n })) }
        ]
      : [])
  ]
}

// save under `name`: replaces a layout of the same name (in its place), else goes at the end
export function putLayout<T extends { name: string }>(list: T[] | undefined, item: T): T[] {
  const all = list ?? []
  return all.some(l => l.name === item.name) ? all.map(l => (l.name === item.name ? item : l)) : [...all, item]
}
