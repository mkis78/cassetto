import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { ArrowRightLeft, LayoutDashboard, Save, ClipboardPaste, Columns2, Columns3, Copy, CopyPlus, Eye, ExternalLink, FilePlus, FolderOpen, FolderPlus, GalleryHorizontal, LayoutGrid, Link, List, Maximize2, Minimize2, PanelRight, Pencil, Plus, RotateCw, Scissors, Trash2, X, XSquare, type LucideIcon } from 'lucide-react'
import type { MenuItem } from '../shared/menus'

// the icon of each menu item, by its id
const BY_ID: Record<string, LucideIcon> = {
  open: ExternalLink,
  folder: FolderOpen,
  'split:right': Columns2,
  'split:within': Plus,
  copyPath: Link,
  newFile: FilePlus,
  newFolder: FolderPlus,
  paste: ClipboardPaste,
  rename: Pencil,
  unname: ArrowRightLeft,
  duplicate: CopyPlus,
  copy: Copy,
  cut: Scissors,
  delete: Trash2,
  refresh: RotateCw,
  'view:list': List,
  'view:icons': LayoutGrid,
  'view:columns': Columns3,
  'view:gallery': GalleryHorizontal,
  hidden: Eye,
  preview: PanelRight,
  maximize: Maximize2,
  restore: Minimize2,
  close: X,
  closeOthers: XSquare,
  save: Save,
  'layout:': LayoutDashboard,
  'delete:': Trash2
}

// 16pt at 2x, black: main marks it a template image, so macOS paints it in the menu's own colour (dark mode, highlight)
const SIZE = 32
const cache = new Map<LucideIcon, Promise<string | null>>()

function png(Icon: LucideIcon): Promise<string | null> {
  if (!cache.has(Icon))
    cache.set(
      Icon,
      new Promise(done => {
        // the icon's SVG, rendered off-screen (react-dom/server would double the bundle for this)
        const el = document.createElement('div')
        const root = createRoot(el)
        flushSync(() => root.render(<Icon size={SIZE} strokeWidth={2} color="#000" />))
        const svg = el.innerHTML
        root.unmount()
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = c.height = SIZE
          c.getContext('2d')!.drawImage(img, 0, 0)
          done(c.toDataURL('image/png'))
        }
        img.onerror = () => done(null) // the item shows without an icon
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      })
    )
  return cache.get(Icon)!
}

const withIcons = (items: MenuItem[]): Promise<MenuItem[]> =>
  Promise.all(
    items.map(async i => {
      // by id, else by its prefix ("layout:Progetto" → "layout:")
      const Icon = i.id && !i.dot ? (BY_ID[i.id] ?? BY_ID[i.id.slice(0, i.id.indexOf(':') + 1)]) : undefined
      const image = Icon ? await png(Icon) : null
      return { ...i, ...(image && { image }), ...(i.submenu && { submenu: await withIcons(i.submenu) }) }
    })
  )

// a native menu with its icons; resolves with the chosen id, or null
export const popup = async (items: MenuItem[], at?: { x: number; y: number }) => window.api.popupMenu(await withIcons(items), at)
