// Context menus as data: the renderer builds them, main shows them natively and returns the chosen id.
import { t, tx } from './i18n'

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
export const COLOR_NAMES: Record<TabColor, string> = { red: tx('Rosso'), yellow: tx('Giallo'), green: tx('Verde'), teal: tx('Verde acqua'), blue: tx('Blu'), purple: tx('Viola') }
// anything outside the palette (an old or hand-edited state.json) is no colour
export const tabColor = (v: unknown): TabColor | undefined => (TAB_COLORS.includes(v as TabColor) ? (v as TabColor) : undefined)

export const shortcut = (key: string, platform: string): string => (platform === 'darwin' ? `CmdOrCtrl+${key}` : `Ctrl+Shift+${key}`)

const sep: MenuItem = { label: '', separator: true }

// The "Tag" submenu: each known tag ticked when every selected item has it; ids "tag:<index in known>".
// dots: each colour's hex (index 0, no colour, is a ring)
export function tagsMenu(c: { known: { name: string; color: number }[]; has: (name: string) => 'all' | 'some' | 'none'; dots: string[] }): MenuItem {
  return {
    label: t('Tag'),
    submenu: [
      ...c.known.map((tag, i) => ({ id: `tag:${i}`, label: t(tag.name) + (c.has(tag.name) === 'some' ? ' ' + t('(alcuni)') : ''), checked: c.has(tag.name) === 'all', dot: tag.color ? c.dots[tag.color] : c.dots[1], hollow: !tag.color })),
      sep,
      { id: 'tags', label: t('Modifica tag…') }
    ]
  }
}

// count: entries selected; paste: what the internal clipboard holds ('other-host': copied on another host, null: nothing);
// tags: the Tag submenu, for local files
export function filesMenu(c: { target: 'file' | 'dir' | 'background'; remote: boolean; count?: number; paste?: 'ok' | 'other-host' | null; tags?: MenuItem }): MenuItem[] {
  const create = [
    sep,
    { id: 'newFile', label: t('Nuovo file') },
    { id: 'newFolder', label: t('Nuova cartella') },
    { id: 'paste', label: c.paste === 'other-host' ? t('Incolla (solo dallo stesso host)') : t('Incolla'), enabled: c.paste === 'ok' }
  ]
  const edit = [
    sep,
    { id: 'rename', label: t('Rinomina'), enabled: (c.count ?? 1) === 1 },
    { id: 'duplicate', label: t('Duplica') },
    { id: 'copy', label: t('Copia') },
    { id: 'cut', label: t('Taglia') },
    sep,
    { id: 'delete', label: c.remote ? t('Elimina definitivamente…') : t('Sposta nel Cestino') }
  ]
  const split = [sep, { id: 'split:right', label: t('Apri in un pannello a destra') }, { id: 'split:within', label: t('Apri in un nuovo tab') }, { id: 'terminal', label: t('Apri terminale qui') }]
  const tag = c.tags ? [sep, c.tags] : []
  if (c.target === 'file') return [{ id: 'open', label: c.remote ? t('Apri nell\'editor') : t('Apri') }, ...(c.remote ? [] : [{ id: 'edit', label: t('Modifica nell\'editor') }]), { id: 'copyPath', label: t('Copia percorso') }, ...tag, ...edit]
  if (c.target === 'dir') return [{ id: 'open', label: t('Apri') }, ...split, { id: 'copyPath', label: t('Copia percorso') }, ...tag, ...create, ...edit]
  return [{ id: 'refresh', label: t('Aggiorna') }, { id: 'terminal', label: t('Apri terminale qui') }, ...create]
}

// a terminal tab
export function terminalMenu(c: { hasSelection: boolean; platform: string }): MenuItem[] {
  return [
    { id: 'copy', label: t('Copia'), accelerator: shortcut('C', c.platform), enabled: c.hasSelection },
    { id: 'paste', label: t('Incolla'), accelerator: shortcut('V', c.platform) },
    { id: 'selectAll', label: t('Seleziona tutto') },
    { id: 'find', label: t('Cerca…'), accelerator: shortcut('F', c.platform) },
    { id: 'clear', label: t('Pulisci') },
    sep,
    { id: 'folder', label: t('Apri la cartella in un tab') },
    sep,
    { id: 'close', label: t('Chiudi tab'), accelerator: shortcut('W', c.platform) }
  ]
}

// the files tile's "Vista" button: how the folder is drawn, what shows
export function viewMenu(c: { view: 'list' | 'icons' | 'columns' | 'gallery'; hidden: boolean; preview: boolean }): MenuItem[] {
  const views = [['list', t('Elenco')], ['icons', t('Icone')], ['columns', t('Colonne')], ['gallery', t('Galleria')]] as const
  return [
    ...views.map(([id, label]) => ({ id: `view:${id}`, label, checked: c.view === id })),
    sep,
    { id: 'hidden', label: t('Mostra file nascosti'), checked: c.hidden },
    { id: 'preview', label: t('Anteprima'), accelerator: 'Space', checked: c.preview, enabled: c.view !== 'gallery' } // the gallery has its own
  ]
}

// the files tile's "Azioni" button: on the folder shown
export function actionsMenu(c: { ready: boolean; paste: 'ok' | 'other-host' | null }): MenuItem[] {
  return [
    { id: 'newFile', label: t('Nuovo file'), enabled: c.ready },
    { id: 'newFolder', label: t('Nuova cartella'), enabled: c.ready },
    { id: 'terminal', label: t('Apri terminale qui'), enabled: c.ready },
    { id: 'paste', label: c.paste === 'other-host' ? t('Incolla (solo dallo stesso host)') : t('Incolla'), enabled: c.ready && c.paste === 'ok' },
    sep,
    { id: 'refresh', label: t('Aggiorna') }
  ]
}

// a search hit: `line` when it comes from a content search
export function searchMenu(c: { line: boolean }): MenuItem[] {
  return [
    { id: 'open', label: t('Apri') },
    { id: 'copyPath', label: c.line ? t('Copia percorso:riga') : t('Copia percorso') },
    sep,
    { id: 'folder', label: t('Apri cartella') }
  ]
}

// dots: each colour's hex in the current theme, read from the CSS by the renderer
export function tabMenu(c: { maximized: boolean; others: boolean; color?: TabColor; named?: boolean; dots?: Partial<Record<TabColor | 'none', string>> }): MenuItem[] {
  return [
    { id: 'rename', label: t('Rinomina…') },
    ...(c.named ? [{ id: 'unname', label: t('Usa il nome della cartella') }] : []),
    {
      label: t('Colore'),
      submenu: [
        { id: 'color:', label: (c.color ? '' : '✓ ') + t('Nessuno'), dot: c.dots?.none, hollow: true },
        ...TAB_COLORS.map(k => ({ id: `color:${k}`, label: (c.color === k ? '✓ ' : '') + t(COLOR_NAMES[k]), dot: c.dots?.[k] }))
      ]
    },
    sep,
    c.maximized ? { id: 'restore', label: t('Ripristina') } : { id: 'maximize', label: t('Massimizza') },
    { id: 'close', label: t('Chiudi tab') },
    { id: 'closeOthers', label: t('Chiudi gli altri tab'), enabled: c.others }
  ]
}

// the top bar's "Layout" button: arrange the open tabs, save them, reopen or delete a saved layout (ids carry the name)
export function layoutsMenu(names: string[], arrangements: { id: string; label: string }[] = []): MenuItem[] {
  return [
    ...arrangements.map(a => ({ id: `arrange:${a.id}`, label: a.label })),
    ...(arrangements.length ? [sep] : []),
    { id: 'save', label: t('Salva layout corrente…') },
    ...(names.length
      ? [
          sep,
          ...names.map(n => ({ id: `layout:${n}`, label: n })),
          sep,
          { label: t('Elimina'), submenu: names.map(n => ({ id: `delete:${n}`, label: n })) }
        ]
      : [])
  ]
}

// save under `name`: replaces a layout of the same name (in its place), else goes at the end
export function putLayout<T extends { name: string }>(list: T[] | undefined, item: T): T[] {
  const all = list ?? []
  return all.some(l => l.name === item.name) ? all.map(l => (l.name === item.name ? item : l)) : [...all, item]
}
