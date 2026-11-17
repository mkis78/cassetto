import { useEffect, useRef, useState } from 'react'
import type { DockviewApi } from 'dockview-react'
import { ChevronDown, ChevronRight, Download, Eject, FileText, Film, Folder, HardDrive, Home, Image, Monitor, Music, PanelLeftClose, PanelLeftOpen, Server, type LucideIcon } from 'lucide-react'
import type { Place, SidebarState, Volume } from '../shared/types'
import type { Disk } from '../shared/status'
import type { TabColor } from '../shared/menus'
import { listKey } from '../shared/listNav'
import { t, tx } from '../shared/i18n'
import { baseName, navigate, PLACE_DND } from './tiles'
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
type Item = { key: string; host: string | null; path: string | null; name: string; icon: LucideIcon; color?: TabColor; fav?: boolean; disk?: Disk | null; eject?: string }
type Where = { host: string | null; path: string | null }

export const SIDEBAR_WIDTH = { def: 200, min: 150, max: 360 }

// one per window, left of the panels: a floating panel, or a rail of icons when collapsed
export default function Sidebar({ state, onChange, api, activePath }: { state: SidebarState; onChange: (s: SidebarState) => void; api: DockviewApi | null; activePath: Where | null }) {
  const [places, setPlaces] = useState<Place[]>([])
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [hosts, setHosts] = useState<string[]>([])
  const [disks, setDisks] = useState<Record<string, Disk | null>>({})
  const { collapsed = false, closed = [], favourites = [] } = state
  const width = state.width ?? SIDEBAR_WIDTH.def

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
    ['fav', favourites.map(f => ({ key: `f:${f.host ?? ''}:${f.path}`, host: f.host, path: f.path, name: f.name ?? (baseName(f.path) || '/'), icon: Folder, color: f.color, fav: true }))],
    ['places', places.map(p => ({ key: `p:${p.id}`, host: null, path: p.path, name: t(PLACE[p.id].name), icon: PLACE[p.id].icon }))],
    ['disks', volumes.map(v => ({ key: `d:${v.path}`, host: null, path: v.path, name: v.name, icon: HardDrive, disk: disks[v.path], eject: v.path }))],
    ['servers', hosts.map(h => ({ key: `s:${h}`, host: h, path: null, name: h, icon: Server }))]
  ]
  const on = (it: Item) => !!activePath && it.host === activePath.host && (it.path === null || it.path === activePath.path)

  const open = (it: Item, e: React.MouseEvent) => api && navigate(api, it, e.metaKey || e.ctrlKey)
  const drag = (it: Item, e: React.DragEvent) => {
    e.dataTransfer.setData(PLACE_DND, JSON.stringify({ host: it.host, path: it.path }))
    e.dataTransfer.effectAllowed = 'copy'
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
  const toggleLabel = collapsed ? t('Espandi barra laterale') : t('Comprimi barra laterale')
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose

  if (collapsed)
    return (
      <nav ref={root} className="sidebar rail" onKeyDown={keys}>
        <button className="sb-toggle" title={toggleLabel} onClick={() => onChange({ ...state, collapsed: false })}>
          <ToggleIcon {...ICON} />
        </button>
        {sections
          .filter(([, items]) => items.length)
          .map(([s, items]) => (
            <div key={s} className="sb-rail-group">
              {items.map(it => (
                <button key={it.key} className={'sb-item' + (on(it) ? ' on' : '')} title={it.host && it.path ? `${it.host}: ${it.name}` : it.name} draggable onDragStart={e => drag(it, e)} onClick={e => open(it, e)}>
                  {it.fav ? <span className={`sb-square c-${it.color ?? 'teal'}`}>{it.name.slice(0, 1).toUpperCase()}</span> : <it.icon {...ICON} />}
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
          .filter(([, items]) => items.length)
          .map(([s, items]) => (
            <section key={s}>
              <button className="sb-head" onClick={() => toggle(s)}>
                {t(SECTION_NAME[s])}
                {closed.includes(s) ? <ChevronRight size={11} strokeWidth={2} /> : <ChevronDown size={11} strokeWidth={2} />}
              </button>
              {!closed.includes(s) &&
                items.map(it => (
                  <div key={it.key} className="sb-row">
                    <button className={'sb-item' + (on(it) ? ' on' : '') + (it.color ? ` c-${it.color}` : '')} title={it.host && it.path ? `${it.host}:${it.path}` : (it.path ?? it.name)} draggable onDragStart={e => drag(it, e)} onClick={e => open(it, e)}>
                      <it.icon {...ICON} />
                      <span className="sb-name">{it.name}</span>
                    </button>
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
          ))}
      </div>
      <div className="sb-resize" onPointerDown={resize} />
    </nav>
  )
}
