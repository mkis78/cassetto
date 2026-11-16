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
  const split = [sep, { id: 'split:right', label: 'Apri in un pannello a destra' }, { id: 'split:within', label: 'Apri in un nuovo tab' }]
  if (c.target === 'file') return [{ id: 'open', label: 'Apri' }, { id: 'copyPath', label: 'Copia percorso' }, ...edit]
  if (c.target === 'dir') return [{ id: 'open', label: 'Apri' }, ...split, { id: 'copyPath', label: 'Copia percorso' }, ...create, ...edit]
  return [{ id: 'refresh', label: 'Aggiorna' }, ...create]
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
