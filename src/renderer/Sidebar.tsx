import { useEffect, useRef, useState } from 'react'
import type { DockviewApi } from 'dockview-react'
import { ChevronDown, ChevronRight, Download, Eject, FileText, Film, Folder, HardDrive, Home, Image, Monitor, Music, PanelLeftClose, PanelLeftOpen, Server, ServerCog, type LucideIcon } from 'lucide-react'
import type { Favourite, Place, SidebarState, Volume } from '../shared/types'
import type { Disk } from '../shared/status'
import { favouriteMenu, tabColor, type TabColor } from '../shared/menus'
import { addFavourite, moveFavourite, pushRecent } from '../shared/favourites'
import { isInside } from '../shared/fileOps'
import { dirOf } from './FileSearch'
import { listKey } from '../shared/listNav'
import { t, tx } from '../shared/i18n'
import { baseName, changed, navigate, PLACE_DND } from './tiles'
import { DND } from './FilesTile'
import { themeDots } from './Tab'
import { popup } from './menuIcons'
import { ICON } from './icons'

const PLACE: Record<Place['id'], { name: string; icon: LucideIcon }> = {
  home: { name: tx('Home'), icon: Home },
  desktop: { name: tx('Scrivania'), icon: Monitor },
  documents: { name: tx('Documenti'), icon: FileText },
  downloads: { name: tx('Download'), icon: Download },
  pictures: { name: tx('Immagini'), icon: Image },
  music: { name: tx('Musica'), icon: Music },
  videos: { name: tx('Video'), icon: Film }
}
type Section = 'fav' | 'places' | 'disks' | 'servers'
const SECTION_NAME: Record<Section, string> = { fav: tx('Preferiti'), places: tx('Posizioni'), disks: tx('Dischi'), servers: tx('Server') }
// fav: the favourite's index in the list
// action: not a place but a command (the full server list)
type Item = { key: string; host: string | null; path: string | null; name: string; icon: LucideIcon; color?: TabColor; fav?: number; disk?: Disk | null; eject?: string; action?: () => void }
type Where = { host: string | null; path: string | null }

export const SIDEBAR_WIDTH = { def: 200, min: 150, max: 360 }
// a favourite dragged within its section carries its index here, alongside PLACE_DND
const FAV_DND = 'cassetto/favourite'
const toast = (text: string) => window.dispatchEvent(new CustomEvent('cassetto:toast', { detail: { text, error: true } }))
const child = (dir: string, name: string) => (dir === '/' ? '/' : dir + '/') + name

// one per window, left of the panels: a floating panel, or a rail of icons when collapsed;
// tiles: Favourites and Places as a grid of coloured tiles (expanded only)
// onAllServers: the full, searchable list of hosts (the Cmd+K dialog)
export default function Sidebar({ state, onChange, api, activePath, tiles, onAllServers }: { state: SidebarState; onChange: (s: SidebarState) => void; api: DockviewApi | null; activePath: Where | null; tiles: boolean; onAllServers: () => void }) {
  const [places, setPlaces] = useState<Place[]>([])
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [hosts, setHosts] = useState<string[]>([])
  const [disks, setDisks] = useState<Record<string, Disk | null>>({})
  const [gone, setGone] = useState<Set<string>>(new Set()) // favourites that did not list when clicked: dimmed
  const [dropOn, setDropOn] = useState<string | null>(null) // the item (or 'fav', the section) a drag is over
  const [renaming, setRenaming] = useState<string | null>(null)
  const ended = useRef(false) // the rename box already decided (Enter, Esc): its blur must not save again
  const { collapsed = false, closed = [], favourites = [] } = state
  const width = state.width ?? SIDEBAR_WIDTH.def
  // the state of now, for what finishes after an await
  const latest = useRef(state)
  latest.current = state
  const setFavs = (f: (l: Favourite[]) => Favourite[]) => onChange({ ...latest.current, favourites: f(latest.current.favourites ?? []) })

  useEffect(() => void window.api.sshHosts().then(setHosts), [])
  // disks come and go: again on focus, and every 5 s while the bar is expanded
  const refresh = () => void window.api.places().then(r => (setPlaces(r.places), setVolumes(r.volumes)))
  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    const timer = collapsed ? undefined : setInterval(refresh, 5000)
    return () => (window.removeEventListener('focus', refresh), clearInterval(timer))
  }, [collapsed])
  const volKey = volumes.map(v => v.path).join('\n')
  useEffect(() => {
    let live = true
    Promise.all(volumes.map(v => window.api.disk(null, v.path))).then(ds => live && setDisks(Object.fromEntries(volumes.map((v, i) => [v.path, ds[i]]))))
    return () => void (live = false)
  }, [volKey])

  const sections: [Section, Item[]][] = [
    // no colour is the accent
    ['fav', favourites.map((f, i) => ({ key: `f:${f.host ?? ''}:${f.path}`, host: f.host, path: f.path, name: f.name ?? (baseName(f.path) || '/'), icon: Folder, color: f.color ?? 'teal', fav: i }))],
    ['places', places.map(p => ({ key: `p:${p.id}`, host: null, path: p.path, name: t(PLACE[p.id].name), icon: PLACE[p.id].icon }))],
    ['disks', volumes.map(v => ({ key: `d:${v.path}`, host: null, path: v.path, name: v.name, icon: HardDrive, disk: disks[v.path], eject: v.path }))],
    // a long ~/.ssh/config would fill the bar: only the last ones opened, the rest one click away
    ['servers', hosts.length ? [...(state.recentHosts ?? []).filter(h => hosts.includes(h)).map(h => ({ key: `s:${h}`, host: h, path: null, name: h, icon: Server })), { key: 's:*', host: null, path: null, name: t('Tutti i server…'), icon: ServerCog, action: onAllServers }] : []]
  ]
  const on = (it: Item) => !it.action && !!activePath && it.host === activePath.host && (it.path === null || it.path === activePath.path)

  const open = (it: Item, e: React.MouseEvent) => {
    if (it.action) return it.action()
    if (!api) return
    navigate(api, it, e.metaKey || e.ctrlKey)
    if (it.host && it.path === null) onChange({ ...latest.current, recentHosts: pushRecent(latest.current.recentHosts, it.host) })
    // ponytail: listed a second time (the tab lists it too) just to learn whether it is still there; an event from the tab if that ever costs
    if (it.fav !== undefined)
      void window.api.listDir(it.host, it.path).then(r =>
        setGone(g => {
          const n = new Set(g)
          r.ok ? n.delete(it.key) : n.add(it.key)
          return n
        })
      )
  }
  const drag = (it: Item, e: React.DragEvent) => {
    e.dataTransfer.setData(PLACE_DND, JSON.stringify({ host: it.host, path: it.path }))
    if (it.fav !== undefined) e.dataTransfer.setData(FAV_DND, String(it.fav))
    e.dataTransfer.effectAllowed = it.fav !== undefined ? 'copyMove' : 'copy'
  }

  // files from a panel dropped on a folder here: moved in (Option copies) through main, so Undo takes them back.
  // Same host only; a name already there fails and is reported, nothing is overwritten
  const dropFiles = async (dest: string, host: string | null, raw: string, alt: boolean) => {
    const d = JSON.parse(raw) as { host: string | null; paths: string[]; copyOnly?: true }
    const copy = alt || !!d.copyOnly // out of an archive: always a copy
    if (d.host !== host) return toast(t('Solo tra file dello stesso host'))
    const srcs = copy ? d.paths : d.paths.filter(p => dirOf(p) !== dest)
    if (srcs.some(s => isInside(s, dest))) return toast(t('Non puoi copiare o spostare una cartella dentro sé stessa'))
    if (!srcs.length) return
    const r = await window.api.fileOp(host, { op: copy ? 'copy' : 'move', items: srcs.map(src => ({ src, dest: child(dest, baseName(src)), replace: false })) })
    changed('sidebar', [dest, ...(copy ? [] : srcs.map(dirOf))])
    if (r.failed.length) toast(r.failed.map(f => `${baseName(f.path)}: ${f.error}`).join('\n'))
  }
  // on a favourite, place or disk: files go in; on a favourite, a dragged favourite takes its place
  const itemDrop = (it: Item) =>
    it.path === null
      ? {}
      : {
          onDragOver: (e: React.DragEvent) => {
            const reorder = it.fav !== undefined && e.dataTransfer.types.includes(FAV_DND)
            if (!reorder && !e.dataTransfer.types.includes(DND)) return
            e.preventDefault()
            e.stopPropagation()
            e.dataTransfer.dropEffect = !reorder && e.altKey ? 'copy' : 'move'
            setDropOn(it.key)
          },
          onDragLeave: () => setDropOn(d => (d === it.key ? null : d)),
          onDrop: (e: React.DragEvent) => {
            setDropOn(null)
            const from = it.fav !== undefined ? e.dataTransfer.getData(FAV_DND) : ''
            const raw = e.dataTransfer.getData(DND)
            if (!from && !raw) return
            e.preventDefault()
            e.stopPropagation()
            if (from) setFavs(l => moveFavourite(l, Number(from), it.fav!))
            else void dropFiles(it.path!, it.host, raw, e.altKey)
          }
        }
  // on the Favourites section itself: a folder from a panel (or a place) becomes a favourite; a favourite goes last
  const favDrop = {
    onDragOver: (e: React.DragEvent) => {
      if (![DND, PLACE_DND].some(k => e.dataTransfer.types.includes(k))) return
      e.preventDefault()
      e.dataTransfer.dropEffect = e.dataTransfer.types.includes(FAV_DND) ? 'move' : 'copy'
      setDropOn('fav')
    },
    onDragLeave: (e: React.DragEvent) => !e.currentTarget.contains(e.relatedTarget as Node) && setDropOn(d => (d === 'fav' ? null : d)),
    onDrop: async (e: React.DragEvent) => {
      setDropOn(null)
      const from = e.dataTransfer.getData(FAV_DND)
      const place = e.dataTransfer.getData(PLACE_DND)
      const raw = e.dataTransfer.getData(DND)
      e.preventDefault()
      e.stopPropagation()
      if (from) return setFavs(l => moveFavourite(l, Number(from), l.length - 1))
      if (place) {
        const w = JSON.parse(place) as { host: string | null; path: string | null }
        return void (w.path !== null && setFavs(l => addFavourite(l, { host: w.host, path: w.path! })))
      }
      if (!raw) return
      const d = JSON.parse(raw) as { host: string | null; paths: string[]; copyOnly?: true }
      if (d.copyOnly) return // a folder inside an archive lives in a cache that goes away
      // only folders, the ones that list: the drag does not say which are
      const dirs = (await Promise.all(d.paths.map(async p => ((await window.api.listDir(d.host, p)).ok ? p : null)))).filter(p => p !== null)
      if (!dirs.length) return toast(t('Solo le cartelle vanno nei preferiti'))
      setFavs(l => dirs.reduce((acc, path) => addFavourite(acc, { host: d.host, path }), l))
    }
  }
  const favMenu = async (it: Item, e: React.MouseEvent) => {
    e.preventDefault()
    const i = it.fav!
    const choice = await popup(favouriteMenu({ color: favourites[i].color, dots: themeDots() }))
    if (choice === 'rename') (ended.current = false), setRenaming(it.key)
    if (choice?.startsWith('color:')) setFavs(l => l.map((f, j) => (j === i ? { ...f, color: tabColor(choice.slice(6)) } : f)))
    if (choice === 'remove') setFavs(l => l.filter((_, j) => j !== i))
  }
  const rename = (i: number, v: string | null) => {
    if (ended.current) return
    ended.current = true
    setRenaming(null)
    if (v !== null) setFavs(l => l.map((f, j) => (j === i ? { ...f, name: v.trim() || undefined } : f))) // empty: the folder's name again
  }

  const eject = async (path: string) => {
    const err = await window.api.eject(path)
    if (err) window.dispatchEvent(new CustomEvent('cassetto:toast', { detail: { text: err, error: true } }))
    refresh()
  }
  const toggle = (s: Section) => onChange({ ...state, closed: closed.includes(s) ? closed.filter(x => x !== s) : [...closed, s] })
  // ↑↓ between the items like the other lists; Enter is the button's own click
  const root = useRef<HTMLDivElement>(null)
  const keys = (e: React.KeyboardEvent) => {
    const items = [...(root.current?.querySelectorAll<HTMLElement>('.sb-item') ?? [])]
    const i = listKey(e.key, items.indexOf(document.activeElement as HTMLElement), items.length)
    if (i === null) return
    e.preventDefault()
    items[i].focus()
  }
  // the right edge: drag to resize
  const resize = (e: React.PointerEvent) => {
    const x0 = e.clientX
    const move = (m: PointerEvent) => onChange({ ...state, width: Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width + m.clientX - x0)) })
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up))
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const cls = (it: Item, tile = false) =>
    'sb-item' + (tile ? ' sb-tile' : '') + (on(it) ? ' on' : '') + (it.color ? ` c-${it.color}` : '') + (gone.has(it.key) ? ' gone' : '') + (dropOn === it.key ? ' drop' : '')
  // an item of the expanded bar, as a row or (tile) a tile; a favourite being renamed is a box
  const item = (it: Item, tile: boolean) =>
    renaming === it.key ? (
      <div className={cls(it, tile)}>
        <it.icon {...ICON} />
        <input
          className="sb-rename"
          autoFocus
          spellCheck={false}
          defaultValue={it.name}
          onKeyDown={e => (e.stopPropagation(), e.key === 'Enter' ? rename(it.fav!, e.currentTarget.value) : e.key === 'Escape' && rename(it.fav!, null))}
          onBlur={e => rename(it.fav!, e.currentTarget.value)}
        />
      </div>
    ) : (
      <button
        className={cls(it, tile)}
        title={it.host && it.path ? `${it.host}:${it.path}` : (it.path ?? it.name)}
        draggable={!it.action}
        onDragStart={e => drag(it, e)}
        onClick={e => open(it, e)}
        onContextMenu={it.fav !== undefined ? e => void favMenu(it, e) : undefined}
        {...itemDrop(it)}
      >
        <it.icon {...ICON} />
        <span className="sb-name">{it.name}</span>
      </button>
    )
  const toggleLabel = collapsed ? t('Espandi barra laterale') : t('Comprimi barra laterale')
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose

  if (collapsed)
    return (
      <nav ref={root} className="sidebar rail" onKeyDown={keys}>
        <button className="sb-toggle" title={toggleLabel} onClick={() => onChange({ ...state, collapsed: false })}>
          <ToggleIcon {...ICON} />
        </button>
        {sections
          // servers: one icon for the whole list, not a row of identical ones
          .map(([s, items]): [Section, Item[]] => [s, s === 'servers' ? items.filter(it => it.action) : items])
          .filter(([, items]) => items.length)
          .map(([s, items]) => (
            <div key={s} className="sb-rail-group">
              {items.map(it => (
                <button key={it.key} className={cls(it)} title={it.host && it.path ? `${it.host}: ${it.name}` : it.name} draggable={!it.action} onDragStart={e => drag(it, e)} onClick={e => open(it, e)} {...itemDrop(it)}>
                  {it.fav !== undefined ? <span className="sb-square">{it.name.slice(0, 1).toUpperCase()}</span> : <it.icon {...ICON} />}
                </button>
              ))}
            </div>
          ))}
      </nav>
    )

  return (
    <nav ref={root} className="sidebar" style={{ width }} onKeyDown={keys}>
      <div className="sb-top">
        <button className="sb-toggle" title={toggleLabel} onClick={() => onChange({ ...state, collapsed: true })}>
          <ToggleIcon {...ICON} />
        </button>
      </div>
      <div className="sb-scroll">
        {sections
          // Favourites even when empty: it is where a folder is dropped to become one
          .filter(([s, items]) => items.length || s === 'fav')
          .map(([s, items]) => {
            const grid = tiles && (s === 'fav' || s === 'places')
            return (
              <section key={s} className={s === 'fav' && dropOn === 'fav' ? 'drop' : undefined} {...(s === 'fav' ? favDrop : {})}>
                <button className="sb-head" onClick={() => toggle(s)}>
                  {t(SECTION_NAME[s])}
                  {closed.includes(s) ? <ChevronRight size={11} strokeWidth={2} /> : <ChevronDown size={11} strokeWidth={2} />}
                </button>
                {!closed.includes(s) && !items.length && <div className="sb-hint">{t('Trascina qui una cartella')}</div>}
                {!closed.includes(s) && grid && (
                  <div className="sb-tiles">
                    {items.map(it => (
                      <div key={it.key}>{item(it, true)}</div>
                    ))}
                  </div>
                )}
                {!closed.includes(s) &&
                  !grid &&
                  items.map(it => (
                    <div key={it.key} className="sb-row">
                      {item(it, false)}
                      {it.eject && (
                        <button className="sb-eject" title={t('Espelli')} onClick={() => void eject(it.eject!)}>
                          <Eject size={12} strokeWidth={1.75} />
                        </button>
                      )}
                      {it.disk && it.disk.total > 0 && (
                        <div className="sb-meter">
                          <b style={{ width: `${Math.round(((it.disk.total - it.disk.free) / it.disk.total) * 100)}%` }} />
                        </div>
                      )}
                    </div>
                  ))}
              </section>
            )
          })}
      </div>
      <div className="sb-resize" onPointerDown={resize} />
    </nav>
  )
}
