// Context menus as data: the renderer builds them, main shows them natively and returns the chosen id.
import { t, tx } from './i18n'
import type { AppInfo } from './types'

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
// "Invia a Claude": the path typed at the prompt of a Claude tab (renderer/tiles sendToClaude)
const sendClaude = (on: boolean): MenuItem[] => (on ? [{ id: 'sendClaude', label: t('Invia a Claude') }] : [])

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

// count: entries selected; paste: the internal clipboard holds something (any host: a paste across hosts is a transfer);
// tags: the Tag submenu, for local files; git: "Apri Git qui", claude: "Apri Claude qui" (their compartment is on); openWith: the apps for the selected local files (undefined: no submenu);
// sendClaude: "Invia a Claude", a Claude tab can take the path
export function filesMenu(c: { target: 'file' | 'dir' | 'background'; remote: boolean; count?: number; paste?: boolean; tags?: MenuItem; openWith?: AppInfo[]; archive?: boolean; readOnly?: boolean; git?: boolean; claude?: boolean; sendClaude?: boolean }): MenuItem[] {
  const all = filesMenuAll(c)
  return c.readOnly ? keepOnly(all, id => ['open', 'copy', 'copyPath', 'terminal', 'refresh'].includes(id) || id.startsWith('openWith:')) : all
}

// readOnly (inside an archive): keep the items whose id passes, drop emptied submenus and stray separators
function keepOnly(items: MenuItem[], ok: (id: string) => boolean): MenuItem[] {
  const kept = items.flatMap(i => {
    if (i.separator) return [i]
    if (i.submenu) { const sub = keepOnly(i.submenu, ok); return sub.length ? [{ ...i, submenu: sub }] : [] }
    return i.id && ok(i.id) ? [i] : []
  })
  return kept.filter((i, n) => !i.separator || (n > 0 && n < kept.length - 1 && !kept[n - 1].separator))
}

function filesMenuAll(c: { target: 'file' | 'dir' | 'background'; remote: boolean; count?: number; paste?: boolean; tags?: MenuItem; openWith?: AppInfo[]; archive?: boolean; git?: boolean; claude?: boolean; sendClaude?: boolean }): MenuItem[] {
  const create = [
    sep,
    { id: 'newFile', label: t('Nuovo file') },
    { id: 'newFolder', label: t('Nuova cartella') },
    { id: 'paste', label: t('Incolla'), enabled: !!c.paste }
  ]
  const n = c.count ?? 1
  const edit = [
    sep,
    { id: 'rename', label: n > 1 ? t('Rinomina {n} elementi…', { n }) : t('Rinomina'), enabled: n >= 1 },
    { id: 'duplicate', label: t('Duplica') },
    { id: 'copy', label: t('Copia') },
    { id: 'cut', label: t('Taglia') },
    sep,
    { id: 'delete', label: c.remote ? t('Elimina definitivamente…') : t('Sposta nel Cestino') }
  ]
  const here = [...(c.git && !c.remote ? [{ id: 'git', label: t('Apri Git qui') }] : []), ...(c.claude && !c.remote ? [{ id: 'claude', label: t('Apri Claude qui') }] : [])]
  const split = [sep, { id: 'split:right', label: t('Apri in un pannello a destra') }, { id: 'split:within', label: t('Apri in un nuovo tab') }, { id: 'terminal', label: t('Apri terminale qui') }, ...here]
  const tag = c.tags ? [sep, c.tags] : []
  const copyPath = [{ id: 'copyPath', label: t('Copia percorso') }, ...sendClaude(!!c.sendClaude && !c.remote)]
  const apps: MenuItem[] = c.openWith && !c.remote ? [{ label: t('Apri con'), submenu: [...c.openWith.map((a, i) => ({ id: `openWith:${i}`, label: a.name, image: a.icon })), ...(c.openWith.length ? [sep] : []), { id: 'openWith:other', label: t('Altra app…') }] }] : []
  if (c.target === 'file') return [{ id: 'open', label: c.remote ? t('Apri nell\'editor') : t('Apri') }, ...apps, ...(c.archive ? [{ id: 'extract', label: t('Estrai qui') }] : []), ...(c.remote ? [] : [{ id: 'edit', label: t('Modifica nell\'editor') }]), ...copyPath, ...tag, ...edit]
  if (c.target === 'dir') return [{ id: 'open', label: t('Apri') }, ...split, ...copyPath, { id: 'favourite', label: t('Aggiungi ai preferiti') }, ...tag, ...create, ...edit]
  return [{ id: 'refresh', label: t('Aggiorna') }, { id: 'terminal', label: t('Apri terminale qui') }, ...here, ...create]
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
export function actionsMenu(c: { ready: boolean; paste: boolean; readOnly?: boolean; git?: boolean; claude?: boolean }): MenuItem[] {
  const all: MenuItem[] = [
    { id: 'newFile', label: t('Nuovo file'), enabled: c.ready },
    { id: 'newFolder', label: t('Nuova cartella'), enabled: c.ready },
    { id: 'terminal', label: t('Apri terminale qui'), enabled: c.ready },
    ...(c.git ? [{ id: 'git', label: t('Apri Git qui'), enabled: c.ready }] : []),
    ...(c.claude ? [{ id: 'claude', label: t('Apri Claude qui'), enabled: c.ready }] : []),
    { id: 'paste', label: t('Incolla'), enabled: c.ready && c.paste },
    sep,
    { id: 'refresh', label: t('Aggiorna') }
  ]
  return c.readOnly ? keepOnly(all, id => id === 'terminal' || id === 'refresh') : all
}

// a search hit: `line` when it comes from a content search
export function searchMenu(c: { line: boolean; sendClaude?: boolean }): MenuItem[] {
  return [
    { id: 'open', label: t('Apri') },
    { id: 'copyPath', label: c.line ? t('Copia percorso:riga') : t('Copia percorso') },
    ...sendClaude(!!c.sendClaude),
    sep,
    { id: 'folder', label: t('Apri cartella') }
  ]
}

// the "Colore" submenu of a tab or a favourite: ids "color:<name>", "color:" for none
// dots: each colour's hex in the current theme, read from the CSS by the renderer
type Dots = Partial<Record<TabColor | 'none', string>>
const colorMenu = (color?: TabColor, dots?: Dots): MenuItem => ({
  label: t('Colore'),
  submenu: [
    { id: 'color:', label: (color ? '' : '✓ ') + t('Nessuno'), dot: dots?.none, hollow: true },
    ...TAB_COLORS.map(k => ({ id: `color:${k}`, label: (color === k ? '✓ ' : '') + t(COLOR_NAMES[k]), dot: dots?.[k] }))
  ]
})

// a favourite in the sidebar
export function favouriteMenu(c: { color?: TabColor; dots?: Dots }): MenuItem[] {
  return [{ id: 'rename', label: t('Rinomina…') }, colorMenu(c.color, c.dots), sep, { id: 'remove', label: t('Rimuovi dai preferiti') }]
}

export function tabMenu(c: { maximized: boolean; others: boolean; color?: TabColor; named?: boolean; dots?: Dots }): MenuItem[] {
  return [
    { id: 'rename', label: t('Rinomina…') },
    ...(c.named ? [{ id: 'unname', label: t('Usa il nome della cartella') }] : []),
    colorMenu(c.color, c.dots),
    sep,
    c.maximized ? { id: 'restore', label: t('Ripristina') } : { id: 'maximize', label: t('Massimizza') },
    { id: 'close', label: t('Chiudi tab') },
    { id: 'closeOthers', label: t('Chiudi gli altri tab'), enabled: c.others }
  ]
}

// a workspace's tab in the top bar
export function workspaceMenu(c: { color?: TabColor; closable: boolean; dots?: Dots }): MenuItem[] {
  return [{ id: 'rename', label: t('Rinomina…') }, colorMenu(c.color, c.dots), sep, { id: 'close', label: t('Chiudi spazio'), enabled: c.closable }]
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

// Git tab. Ids carry what they act on ("merge:feat"), so one handler can read them.

// a commit in the graph; `branches` are the local and remote branches pointing at it, `current` the checked-out branch
export function commitMenu(c: { current: string | null; branches: string[]; merge: boolean }): MenuItem[] {
  const others = c.branches.filter(b => b !== c.current)
  const cur = c.current
  return [
    { id: 'branch', label: t('Crea ramo qui…') },
    { id: 'tag', label: t('Crea tag qui…') },
    ...(others.length ? [sep, ...others.map(b => ({ id: `checkout:${b}`, label: t('Checkout {name}', { name: b }) }))] : []),
    // in detached HEAD there is no branch to merge into or rebase
    ...(cur && others.length ? [sep, ...others.flatMap(b => [{ id: `merge:${b}`, label: t('Merge {source} in {target}', { source: b, target: cur }) }, { id: `rebase:${b}`, label: t('Rebase {branch} su {onto}', { branch: cur, onto: b }) }])] : []),
    sep,
    { id: 'cherryPick', label: t('Cherry-pick'), enabled: !c.merge },
    { id: 'revert', label: t('Revert'), enabled: !c.merge },
    {
      label: cur ? t('Reset {name} qui', { name: cur }) : t('Reset qui'),
      submenu: [
        { id: 'reset:soft', label: t('Soft: tieni le modifiche in stage') },
        { id: 'reset:mixed', label: t('Mixed: tieni le modifiche fuori stage') },
        { id: 'reset:hard', label: t('Hard: scarta tutte le modifiche') }
      ]
    },
    sep,
    { id: 'copySha', label: t('Copia SHA') }
  ]
}

// a branch or tag in the sidebar or a badge in the graph
export function refMenu(c: { name: string; kind: 'branch' | 'remote' | 'tag'; current: string | null; remotes: string[]; hidden?: boolean }): MenuItem[] {
  const copy = { id: 'copy', label: t('Copia nome') }
  if (c.kind === 'tag') return [copy]
  const isCurrent = c.kind === 'branch' && c.name === c.current
  const join = c.current && !isCurrent ? [{ id: 'merge', label: t('Merge {source} in {target}', { source: c.name, target: c.current }) }, { id: 'rebase', label: t('Rebase {branch} su {onto}', { branch: c.current, onto: c.name }) }] : []
  // narrowing the graph: this branch alone, or everything but it
  const view = [sep, { id: 'solo', label: t('Mostra solo questo') }, c.hidden ? { id: 'show', label: t('Mostra nel grafo') } : { id: 'hide', label: t('Nascondi dal grafo') }]
  if (c.kind === 'remote') return [{ id: 'checkout', label: t('Checkout') }, ...join, sep, { id: 'deleteRemote', label: t('Elimina dal remoto…') }, ...view, copy]
  return [
    { id: 'checkout', label: t('Checkout'), enabled: !isCurrent },
    ...join,
    sep,
    ...c.remotes.map(r => ({ id: `push:${r}`, label: t('Push su {remote}', { remote: r }) })),
    { id: 'rename', label: t('Rinomina…') },
    { id: 'delete', label: t('Elimina…'), enabled: !isCurrent },
    ...view,
    copy
  ]
}

export const stashMenu = (): MenuItem[] => [
  { id: 'apply', label: t('Applica') },
  { id: 'pop', label: t('Applica ed elimina (pop)') },
  sep,
  { id: 'drop', label: t('Elimina…') }
]

// a file in the changes panel
export function changeMenu(c: { staged: boolean; untracked: boolean; sendClaude?: boolean }): MenuItem[] {
  return [
    c.staged ? { id: 'unstage', label: t('Togli dallo stage') } : { id: 'stage', label: t('Metti in stage') },
    ...(c.staged ? [] : [{ id: 'discard', label: c.untracked ? t('Elimina il file…') : t('Scarta le modifiche…') }]),
    sep,
    ...fileRefMenu(c)
  ]
}

// a file named in a commit or in the working tree
export const fileRefMenu = (c: { sendClaude?: boolean } = {}): MenuItem[] => [
  { id: 'open', label: t("Apri nell'editor") },
  { id: 'copyPath', label: t('Copia percorso') },
  ...sendClaude(!!c.sendClaude)
]

// dragging branch `source` onto `target`: a branch, a remote branch or a remote (remoteName)
export function dropMenu(c: { source: string; sourceRemote: boolean; target: string; targetKind: 'branch' | 'remote' | 'remoteName' }): MenuItem[] {
  const { source, target } = c
  if (c.targetKind === 'remoteName') return c.sourceRemote ? [] : [{ id: 'push', label: t('Push {branch} su {remote}', { branch: source, remote: target }) }]
  if (c.targetKind === 'remote') return c.sourceRemote ? [] : [{ id: 'mergeInto:source', label: t('Merge {source} in {target}', { source: target, target: source }) }, { id: 'rebase', label: t('Rebase {branch} su {onto}', { branch: source, onto: target }) }]
  return [{ id: 'merge', label: t('Merge {source} in {target}', { source, target }) }, ...(c.sourceRemote ? [] : [{ id: 'rebase', label: t('Rebase {branch} su {onto}', { branch: source, onto: target }) }])]
}

// another checkout of the repository, in the git sidebar
export const worktreeMenu = (): MenuItem[] => [
  { id: 'folder', label: t('Apri la cartella in un tab') },
  sep,
  { id: 'copyPath', label: t('Copia percorso') },
  { id: 'removeWorktree', label: t('Rimuovi worktree…') }
]
