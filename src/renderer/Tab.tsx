import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps } from 'dockview-react'
import { FileCode, Folder, Plus, Server, SquareTerminal, X } from 'lucide-react'
import type { TileParams } from '../shared/types'
import { TAB_COLORS, tabColor, tabMenu, type TabColor } from '../shared/menus'
import { ICON } from './icons'
import { closeTiles, focusTile, isDirty, onDirty, openFolder, whereOf } from './tiles'
import { popup } from './menuIcons'
import { t } from '../shared/i18n'

// the palette as the theme paints it now (teal is the accent)
export const themeDots = () => {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  return { none: v('--fg3'), ...Object.fromEntries(TAB_COLORS.map(c => [c, v(c === 'teal' ? '--accent' : `--${c}`)])) }
}

// Tab header: icon, name (the user's, else the folder shown), close button; double click renames, right click colours.
export default function Tab({ api, params, containerApi }: IDockviewPanelHeaderProps<TileParams>) {
  const [title, setTitle] = useState(api.title)
  // kept here too: dockview does not re-render the header when the params change
  const [name, setName] = useState(params.name)
  const [color, setColor] = useState(tabColor(params.color))
  const [renaming, setRenaming] = useState(false)
  const ended = useRef(false) // Enter or Esc already decided: the blur as the box goes away must not save again
  useEffect(() => {
    const d = api.onDidTitleChange(e => setTitle(e.title))
    return () => d.dispose()
  }, [api])
  const save = (o: { name?: string; color?: TabColor }) => {
    const next = { name, color, ...o }
    setName(next.name)
    setColor(next.color)
    // undefined drops the key from the saved layout
    api.updateParameters({ name: next.name, color: next.color })
  }
  const rename = () => ((ended.current = false), setRenaming(true))
  const done = (v: string | null) => {
    if (ended.current) return
    ended.current = true
    setRenaming(false)
    if (v !== null) save({ name: v.trim() || undefined }) // an empty name goes back to the folder's
    focusTile(containerApi.getPanel(api.id))
  }
  const Icon = params.kind === 'terminal' ? SquareTerminal : params.kind === 'editor' ? FileCode : params.host ? Server : Folder
  const unsaved = useSyncExternalStore(onDirty, () => isDirty(api.id))
  return (
    <div
      className={'tile-tab' + (color ? ' c-' + color : '')}
      onDoubleClick={rename}
      onContextMenu={async e => {
        e.preventDefault()
        const others = containerApi.panels.filter(p => p.id !== api.id)
        const choice = await popup(tabMenu({ maximized: api.isMaximized(), others: others.length > 0, color, named: !!name, dots: themeDots() }))
        if (choice === 'rename') rename()
        if (choice === 'unname') save({ name: undefined })
        if (choice?.startsWith('color:')) save({ color: tabColor(choice.slice(6)) })
        if (choice === 'maximize') api.maximize()
        if (choice === 'restore') api.exitMaximized()
        if (choice === 'close') closeTiles([containerApi.getPanel(api.id)!])
        if (choice === 'closeOthers') closeTiles(others)
      }}
    >
      <Icon {...ICON} className="tile-icon files" />
      {renaming ? (
        <input
          className="tab-rename"
          autoFocus
          spellCheck={false}
          defaultValue={name ?? title ?? ''}
          placeholder={title}
          onFocus={e => e.target.select()}
          // the tab must not start a drag or take the keys while a name is typed
          onPointerDown={e => e.stopPropagation()}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') done(e.currentTarget.value)
            if (e.key === 'Escape') done(null)
          }}
          onBlur={e => done(e.target.value)}
        />
      ) : (
        <span title={name ? title : undefined}>{name ?? title ?? ''}</span>
      )}
      {unsaved && (
        <span className="tab-unsaved" title={t('Modifiche non salvate')}>
          ●
        </span>
      )}
      <button className="dv-default-tab-action tile-close" title={t('Chiudi tab')} onPointerDown={e => e.stopPropagation()} onClick={() => closeTiles([containerApi.getPanel(api.id)!])}>
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  )
}

// "+" after the tabs of each group: a new tab there, on the folder of the tab in front
export function NewTabButton({ containerApi, activePanel }: IDockviewHeaderActionsProps) {
  return (
    <button className="tab-add" title={t('Nuovo tab (Cmd+T)')} onClick={() => openFolder(containerApi, whereOf(activePanel), activePanel?.id)}>
      <Plus {...ICON} />
    </button>
  )
}
