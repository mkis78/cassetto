import { useEffect, useState } from 'react'
import type { IDockviewPanelHeaderProps } from 'dockview-react'
import { Folder, Server, X } from 'lucide-react'
import type { TileParams } from '../shared/types'
import { tabMenu } from '../shared/menus'
import { ICON } from './icons'
import { closeTiles } from './tiles'

// Tab header: icon, title (the folder shown), close button.
export default function Tab({ api, params, containerApi }: IDockviewPanelHeaderProps<TileParams>) {
  const [title, setTitle] = useState(api.title)
  useEffect(() => {
    const d = api.onDidTitleChange(e => setTitle(e.title))
    return () => d.dispose()
  }, [api])
  const Icon = params.host ? Server : Folder
  return (
    <div
      className="tile-tab"
      onContextMenu={async e => {
        e.preventDefault()
        const others = containerApi.panels.filter(p => p.id !== api.id)
        const choice = await window.api.popupMenu(tabMenu({ maximized: api.isMaximized(), others: others.length > 0 }))
        if (choice === 'maximize') api.maximize()
        if (choice === 'restore') api.exitMaximized()
        if (choice === 'close') closeTiles([containerApi.getPanel(api.id)!])
        if (choice === 'closeOthers') closeTiles(others)
      }}
    >
      <Icon {...ICON} className="tile-icon files" />
      <span>{title ?? ''}</span>
      <button className="dv-default-tab-action tile-close" title="Chiudi tab" onPointerDown={e => e.stopPropagation()} onClick={() => closeTiles([containerApi.getPanel(api.id)!])}>
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )
}
