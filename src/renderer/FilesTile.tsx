import { useCallback, useEffect, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import type { DirEntry, Listing, Preview, SearchQuery } from '../shared/types'
import { ArrowUp, ChevronDown, FileCode, Tags as TagsIcon, ScanSearch, SlidersHorizontal, SquareTerminal, ChevronRight, ClipboardPaste, Columns2, Copy, CopyPlus, Ellipsis, ExternalLink, Eye, EyeOff, FilePlus, FolderPlus, House, Link, PanelRight, Pencil, RotateCw, Scissors, Search, TextSearch, Trash2, X, Columns3, GalleryHorizontal, File, Folder, LayoutGrid, List } from 'lucide-react'
import { formatSize, imageType } from '../shared/format'
import { ICON } from './icons'
import { renderMarkdown } from '../shared/markdown'
import FileSearch, { dirOf } from './FileSearch'
import { actionsMenu, filesMenu, tagsMenu, viewMenu } from '../shared/menus'
import { knownTags, TAG_HEX, TagDialog, TagDots } from './Tags'
import type { Tag } from '../shared/tags'
import { listKey, typeAhead } from '../shared/listNav'
import { sortBy, type SortKey } from '../shared/sortEntries'
import { baseName, CHANGED, changed, runUndo, openEditor, openFolder, openTerminal, setTileActions } from './tiles'
import type { Command } from './Palette'
import SearchOptions from './SearchOptions'
import StatusBar from './StatusBar'
import { changedOptions } from '../shared/query'
import { locale, t, tx } from '../shared/i18n'
import { getSettings } from './settings'
import { copyName, isInside, nameError, okPrefix, rangeSelect } from '../shared/fileOps'
import type { FileOp, OpResult } from '../shared/types'
import { ConfirmDelete, ConflictDialog, type Choice } from './FileDialogs'
import { popup } from './menuIcons'

type View = 'list' | 'icons' | 'columns' | 'gallery'
type Sort = { key: SortKey; desc: boolean }
type Params = { kind: 'files'; host: string | null; path: string | null; hidden?: boolean; preview?: boolean; query?: SearchQuery | null; view?: View; sort?: Sort; cols?: string[] }
type Col = Listing & { error?: string } // a folder in the columns view, or why it could not be opened

const VIEW_ICON = { list: List, icons: LayoutGrid, columns: Columns3, gallery: GalleryHorizontal }
const VIEW_NAME = { list: tx('Elenco'), icons: tx('Icone'), columns: tx('Colonne'), gallery: tx('Galleria') }

const EMPTY: SearchQuery = { text: '', mode: 'name', regex: false, word: false }

// ponytail: no virtualised list; huge folders show the first entries only
const MAX_SHOWN = 2000

// copy/cut, shared by every Files tile; the paths belong to the host they were taken from
let clip: { host: string | null; paths: string[]; cut: boolean } | null = null
// what a drag carries: the host and the paths; also kept here, since a dragover cannot read the data, only its types
const DND = 'application/x-cassetto-files'
let dragging: { host: string | null; paths: string[] } | null = null
type Editing = { dir: string; kind: 'newFile' | 'newFolder' | 'rename'; name: string; from?: string; error?: string }

const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const parent = (p: string) => p.replace(/\/[^/]+\/?$/, '') || '/'
const child = (dir: string, name: string) => (dir === '/' ? '/' : dir + '/') + name

export default function FilesTile({ params, api, containerApi }: IDockviewPanelProps<Params>) {
  const { host } = params
  const [target, setTarget] = useState<string | null>(params.path) // what we tried to open (null = home)
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hidden, setHidden] = useState(!!params.hidden) // show dotfiles
  const [showPreview, setShowPreview] = useState(!!params.preview)
  const [q, setQ] = useState<SearchQuery>(params.query ?? EMPTY)
  const [sel, setSel] = useState<{ path: string; dir: boolean } | null>(null) // selected entry; a file shows in the preview
  const [preview, setPreview] = useState<{ path: string; p: Preview } | null>(null)
  const [view, setView] = useState<View>(params.view ?? 'list')
  // columns view: the folders open to the right of `listing`, each one selected in the column before it
  const [cols, setCols] = useState<Col[]>([])
  const [sort, setSort] = useState<Sort>(params.sort ?? { key: 'name', desc: false })
  // multi-select: full paths, all in one column; `sel` is the last one clicked (the preview), `anchor` where Shift ranges start
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null) // a name being typed in the list
  const [notice, setNotice] = useState<string | null>(null) // what went wrong, above the list
  const [confirm, setConfirm] = useState<{ paths: string[]; permanent: boolean; note?: string } | null>(null)
  const [conflict, setConflict] = useState<{ names: string[]; done: (c: Record<string, Choice> | null) => void } | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)
  // the selection follows `sel` unless `sel` is already part of it
  useEffect(() => setPicked(p => (!sel ? new Set() : p.has(sel.path) ? p : new Set([sel.path]))), [sel])
  useEffect(() => void api.updateParameters({ sort }), [sort])

  // reopen with the same view after a restart (dockview merges these into the saved params)
  useEffect(() => void api.updateParameters({ hidden, preview: showPreview, query: q, view }), [hidden, showPreview, q, view])
  const set = (o: Partial<SearchQuery>) => setQ(s => ({ ...s, ...o }))
  const [showOpts, setShowOpts] = useState(false) // the search criteria panel
  const closeOpts = useCallback(() => setShowOpts(false), [])

  useEffect(() => {
    if (!(showPreview || view === 'gallery') || !sel || sel.dir) return
    let live = true
    const { path } = sel
    window.api.preview(host, path).then(p => live && setPreview({ path, p }))
    return () => void (live = false)
  }, [sel, showPreview, view, host])

  const listRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => void listRef.current?.querySelector('.file.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }), [sel, cols])

  const seq = useRef(0)
  const load = useCallback(
    async (path: string | null) => {
      const n = ++seq.current
      setTarget(path)
      setLoading(true)
      const r = await window.api.listDir(host, path)
      if (n !== seq.current) return // the user already moved on
      setLoading(false)
      if (r.ok) {
        setListing(r.listing)
        setCols([])
        setError(null)
        api.updateParameters({ path: r.listing.path }) // reopen here after a restart
        api.setTitle(baseName(r.listing.path) || '/')
      } else if (!host && path !== null && path === getSettings().filesHome) load(null) // the base folder is gone: home
      else setError(r.error)
    },
    [host]
  )

  // re-list the open chain in place: the folder, the columns open to its right and the selection stay where they were
  const reload = useCallback(
    async (paths: string[], keepSel?: string | null) => {
      if (!paths.length) return
      const n = ++seq.current
      colSeq.current++ // a column still loading must not come back over this
      const res = await Promise.all(paths.map(p => window.api.listDir(host, p)))
      if (n !== seq.current) return
      const ok = okPrefix(res)
      if (!ok.length) return void (setTarget(paths[0]), setError(res[0].ok ? null : res[0].error))
      setLoading(false)
      setError(null)
      setListing(ok[0])
      setCols(ok.slice(1))
      api.updateParameters({ path: ok[0].path })
      api.setTitle(baseName(ok[0].path) || '/')
      const found = (p: string | null) => {
        const e = p && ok.find(l => l.path === dirOf(p))?.entries.find(x => x.name === p.slice(dirOf(p).length + 1))
        return e && p ? { path: p, dir: e.dir } : null
      }
      setSel(s => found(keepSel !== undefined ? keepSel : (s?.path ?? null)))
    },
    [host]
  )
  const refresh = () => (listing && !error ? reload([listing.path, ...cols.map(c => c.path)]) : load(here))

  useEffect(() => {
    // the columns view reopens as deep as it was left
    if (params.path && params.cols?.length && params.view === 'columns') reload([params.path, ...params.cols])
    else load(params.path)
  }, [load])

  // the folder of column `i`, loaded after the ones before it; a newer pick drops a late answer
  const colSeq = useRef(0)
  useEffect(() => void (listing && api.updateParameters({ cols: cols.filter(c => !c.error).map(c => c.path) })), [cols])
  const loadCol = async (i: number, path: string) => {
    const n = ++colSeq.current
    const r = await window.api.listDir(host, path)
    if (n === colSeq.current) setCols(c => [...c.slice(0, i - 1), r.ok ? r.listing : { path, entries: [], error: r.error }])
  }

  const here = error ? target : (listing?.path ?? null)
  // a remote folder has no recursive search: the box filters what is listed
  const searching = !!q.text && !!listing
  const visible = (l: Listing) => sortBy(l.entries.filter(e => hidden || !e.name.startsWith('.')), sort.key, sort.desc)
  const columns = listing ? (view === 'columns' ? [listing, ...cols] : [listing]) : []

  const open = (full: string, dir: boolean) => {
    if (dir) return void (setSel(null), load(full))
    // a remote file has no app here to open it: it opens in the editor
    if (host) return openEditor(containerApi, { path: full, host }, api.id)
    window.api.openPath(full).then(err => err && setNotice(`${nameOf(full)}: ${err}`))
  }

  // back to the parent with the folder we left selected, like Finder
  const up = () => {
    if (!here || here === '/') return
    setSel({ path: here, dir: true })
    load(parent(here))
  }

  // select an entry of column `i`; in the columns view a folder opens the next column
  // Cmd+click toggles, Shift+click/arrow extends from the anchor; both only within the column already selected in
  const select = (i: number, dir: string, e: DirEntry, how: 'one' | 'toggle' | 'range' = 'one') => {
    const full = child(dir, e.name)
    if (how !== 'one' && sel && dirOf(sel.path) === dir) {
      const entries = visible(columns[i])
      let next: Set<string>
      if (how === 'range') next = new Set(rangeSelect(entries.map(x => x.name), nameOf(anchor.current ?? sel.path), e.name).map(n => child(dir, n)))
      else {
        next = new Set(picked.size ? picked : [sel.path])
        if (next.has(full) && next.size > 1) next.delete(full)
        else next.add(full)
        anchor.current = full
      }
      // the last one clicked stays the current entry, unless Cmd+click just took it out
      const cur = next.has(full) ? full : [...next].pop()!
      setPicked(next)
      setSel({ path: cur, dir: !!entries.find(x => child(dir, x.name) === cur)?.dir })
      if (view === 'columns') (colSeq.current++, setCols(c => c.slice(0, i))) // several picked: no column opens for them
      return
    }
    anchor.current = full
    setPicked(new Set([full])) // a plain click or arrow always ends a multi-selection
    setSel({ path: full, dir: e.dir })
    if (view !== 'columns') return
    colSeq.current++ // a column still loading for an older pick must not come back
    setCols(c => c.slice(0, i))
    if (e.dir) loadCol(i + 1, full)
  }

  // the keys act on the column holding the selection (the only one outside the columns view)
  const ci = Math.max(0, columns.findIndex(c => sel && c.path === dirOf(sel.path)))
  const col = columns[ci]
  const shown = col ? visible(col).slice(0, MAX_SHOWN) : []
  const at = shown.findIndex(e => child(col.path, e.name) === sel?.path)
  const pick = (i: number, how: 'one' | 'range' = 'one') => shown[i] && select(ci, col.path, shown[i], how)
  // icons view: how many icons fit in a row, read from the layout; the gallery is one row, so ↑↓ step by one
  const perRow = () => {
    if (view === 'gallery') return 1
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>('.file') ?? [])]
    return Math.max(1, items.filter(x => x.offsetTop === items[0].offsetTop).length)
  }
  const tiles = view === 'icons' || view === 'gallery' // entries drawn as big icons or thumbnails
  // the open chain (the folder and the columns to its right), for a refresh after an operation
  const chain = useRef<string[]>([])
  chain.current = listing ? [listing.path, ...cols.map(c => c.path)] : []
  const refreshTo = (keep?: string) => reload(chain.current, keep)
  useEffect(() => {
    const f = (e: Event) => {
      const { from, dirs } = (e as CustomEvent<{ from: string; dirs: string[] }>).detail
      if (from !== api.id && chain.current.some(d => dirs.includes(d))) void reload(chain.current)
    }
    window.addEventListener(CHANGED, f)
    return () => window.removeEventListener(CHANGED, f)
  }, [reload])

  // what an action works on: the selection when the clicked entry is part of it, otherwise that entry alone
  const chosen = (full?: string) => (full && !picked.has(full) ? [full] : [...picked])
  const clipFor = () => (!clip ? null : clip.host === host ? 'ok' : 'other-host') as 'ok' | 'other-host' | null

  // what failed, after any message the caller already has; nothing to say leaves the notice alone
  const report = (r: OpResult, before: string[] = []) => {
    const n = r.failed.length
    const lines = n ? [...before, `${n === 1 ? t('1 operazione non riuscita') : t('{n} operazioni non riuscite', { n })}:\n` + r.failed.map(f => `${nameOf(f.path)}: ${f.error}`).join('\n')] : before
    if (lines.length) setNotice(lines.join('\n\n'))
  }
  // a Mac disk does not tell "a" from "A": names clash without regard to case there
  const fold = (n: string) => (!host && window.api.platform === 'darwin' ? n.toLowerCase() : n)

  // copy or move `srcs` into `destDir`, asking about names already there (a duplicate keeps both without asking);
  // true when something was sent to main
  const transfer = async (mode: 'copy' | 'move', srcs: string[], destDir: string, keepAll = false): Promise<boolean> => {
    if (mode === 'move') srcs = srcs.filter(s => dirOf(s) !== destDir) // already there
    if (!srcs.length) return false
    if (srcs.some(s => isInside(s, destDir))) return setNotice(t('Non puoi copiare o spostare una cartella dentro sé stessa')), false
    const r = await window.api.listDir(host, destDir) // fresh: the listing on screen may be old
    if (!r.ok) return setNotice(r.error), false
    const taken = new Set(r.listing.entries.map(e => fold(e.name)))
    const has = (n: string) => taken.has(fold(n))
    const clashes = srcs.map(nameOf).filter(has)
    let choice: Record<string, Choice> = Object.fromEntries(clashes.map(n => [n, 'keep']))
    if (clashes.length && !keepAll) {
      const c = await new Promise<Record<string, Choice> | null>(done => setConflict({ names: clashes, done }))
      setConflict(null)
      if (!c) return false
      choice = c
    }
    const items: { src: string; dest: string; replace: boolean }[] = []
    const refused: string[] = []
    for (const src of srcs) {
      const name = nameOf(src)
      const c = has(name) ? choice[name] : null
      if (c === 'skip') continue
      if (c === 'replace') {
        const dest = child(destDir, name)
        // replacing an entry with itself, or the folder that holds the source, would destroy the source
        if (dest === src || isInside(dest, src)) refused.push(name)
        else items.push({ src, dest, replace: true })
        continue
      }
      const n = c === 'keep' ? copyName(name, { has }) : name
      taken.add(fold(n))
      items.push({ src, dest: child(destDir, n), replace: false })
    }
    const before = refused.length ? [t('Non sostituiti (sostituirebbero sé stessi): {names}', { names: refused.join(', ') })] : []
    if (!items.length) return report({ failed: [] }, before), false
    report(await window.api.fileOp(host, { op: mode, items }), before)
    changed(api.id, [destDir, ...(mode === 'move' ? srcs.map(dirOf) : [])])
    await refreshTo(items.length === 1 ? items[0].dest : undefined)
    return true
  }

  const paste = async (destDir: string) => {
    const c = clip
    if (!c || c.host !== host) return
    if ((await transfer(c.cut ? 'move' : 'copy', c.paths, destDir)) && c.cut) clip = null // a cut is pasted once
  }

  // Finder tags (local only): the entries behind paths, the tags known here, a change applied and shown
  const entryOf = (path: string) => columns.find(c => c.path === dirOf(path))?.entries.find(x => x.name === nameOf(path))
  const [tagging, setTagging] = useState<string[] | null>(null) // the paths the tag dialog works on
  const seenTags = () => columns.flatMap(c => c.entries.flatMap(e => e.tags ?? []))
  const tagState = (paths: string[]) => (name: string) => {
    const n = paths.filter(p => entryOf(p)?.tags?.some(x => x.name === name)).length
    return n === paths.length ? 'all' : n ? 'some' : 'none'
  }
  const applyTags = async (paths: string[], change: { add?: Tag[]; remove?: string[] }) => {
    report(await window.api.editTags(paths, change))
    changed(api.id, paths.map(dirOf))
    await refreshTo()
  }
  const toggleTag = (paths: string[], tag: Tag) => applyTags(paths, tagState(paths)(tag.name) === 'all' ? { remove: [tag.name] } : { add: [tag] })

  const askDelete = (paths: string[]) => void (paths.length && setConfirm({ paths, permanent: !!host }))
  const doDelete = async () => {
    const c = confirm!
    setConfirm(null)
    const r = await window.api.fileOp(host, { op: c.permanent ? 'delete' : 'trash', paths: c.paths })
    changed(api.id, c.paths.map(dirOf))
    await refreshTo()
    // the trash refused some: never fall back by itself, ask again in the permanent wording
    if (!c.permanent && r.failed.length) setConfirm({ paths: r.failed.map(f => f.path), permanent: true, note: t('Il Cestino non ha accettato questi elementi ({error}).', { error: r.failed[0].error }) })
    else report(r)
    listRef.current?.focus()
  }

  // a new entry is named in its own column: its folder is opened first when it is not on screen
  // ponytail: a remote folder reached through a symlink lists under its real path, so the box may not show there
  const startCreate = async (kind: 'newFile' | 'newFolder', dir: string) => {
    if (!columns.some(c => c.path === dir)) await load(dir)
    ended.current = false
    setEditing({ dir, kind, name: '' })
  }
  // set once the box is done with (Esc, or a name that went through): Chrome blurs a box as it goes away, and that blur must not commit
  const ended = useRef(false)
  const close = () => ((ended.current = true), setEditing(null))
  const startRename = (full: string) => (ended.current = false, setEditing({ dir: dirOf(full), kind: 'rename', name: nameOf(full), from: full }))
  const busy = useRef(false) // a second Enter while the first is still on its way
  // from a blur nothing is left to type in: a refused name becomes a notice instead of a box nobody looks at
  const commitEdit = async (blur = false) => {
    const ed = editing
    if (!ed || busy.current || ended.current) return
    const fail = (error: string) => (blur ? (close(), setNotice(`${ed.name}: ${error}`)) : setEditing({ ...ed, error }))
    if (ed.kind === 'rename' && ed.name === nameOf(ed.from!)) return close()
    const taken = new Set(columns.find(c => c.path === ed.dir)?.entries.map(e => e.name))
    if (ed.kind === 'rename') taken.delete(nameOf(ed.from!))
    const err = nameError(ed.name, taken)
    if (err) return fail(err)
    const path = child(ed.dir, ed.name)
    const op: FileOp = ed.kind === 'rename' ? { op: 'rename', from: ed.from!, to: path } : { op: ed.kind === 'newFile' ? 'touch' : 'mkdir', path }
    busy.current = true
    const r = await window.api.fileOp(host, op).finally(() => (busy.current = false))
    if (r.failed.length) return fail(r.failed[0].error)
    changed(api.id, [ed.dir])
    close()
    await refreshTo(path)
    listRef.current?.focus()
  }
  const editBox = (ed: Editing) => (
    <>
      <input
        className="file-edit"
        autoFocus
        spellCheck={false}
        value={ed.name}
        // a rename starts with the name before the extension selected, like Finder
        onFocus={ev => ev.target.setSelectionRange(0, ed.kind === 'rename' && ed.name.lastIndexOf('.') > 0 ? ed.name.lastIndexOf('.') : ed.name.length)}
        onChange={ev => setEditing({ ...ed, name: ev.target.value, error: undefined })}
        onKeyDown={ev => {
          ev.stopPropagation() // typing a name must not move the selection
          if (ev.key === 'Enter') commitEdit()
          if (ev.key === 'Escape') close(), listRef.current?.focus()
        }}
        // clicking away keeps a typed name, like Finder; an empty or refused one is dropped
        onBlur={() => !ended.current && (ed.name.trim() && !ed.error ? commitEdit(true) : close())}
        onClick={ev => ev.stopPropagation()}
        onDoubleClick={ev => ev.stopPropagation()}
      />
      {ed.error && <span className="file-edit-error">{ed.error}</span>}
    </>
  )

  const selectAll = () => {
    if (!col || !shown.length) return
    const s = sel && dirOf(sel.path) === col.path ? sel : { path: child(col.path, shown[0].name), dir: shown[0].dir }
    setPicked(new Set(shown.map(x => child(col.path, x.name))))
    setSel(s)
  }

  // drag the selection onto a folder or a folder's background, in this tile or another on the same host:
  // move, or copy with Alt
  const drag = (ev: React.DragEvent, full: string) => {
    dragging = { host, paths: chosen(full) }
    ev.dataTransfer.setData(DND, JSON.stringify(dragging))
    ev.dataTransfer.effectAllowed = 'copyMove'
  }
  const dropProps = (dir: string) => ({
    onDragOver: (ev: React.DragEvent) => {
      // ponytail: no drops across hosts; copying between machines needs a transfer of its own
      if (!ev.dataTransfer.types.includes(DND) || dragging?.host !== host) return
      ev.preventDefault()
      ev.stopPropagation()
      ev.dataTransfer.dropEffect = ev.altKey ? 'copy' : 'move'
      setDropOn(dir)
    },
    onDragLeave: () => setDropOn(d => (d === dir ? null : d)),
    onDrop: (ev: React.DragEvent) => {
      setDropOn(null)
      const raw = ev.dataTransfer.getData(DND)
      if (!raw) return
      ev.preventDefault()
      ev.stopPropagation()
      const d = JSON.parse(raw) as { host: string | null; paths: string[] }
      if (d.host === host && !d.paths.includes(dir)) transfer(ev.altKey ? 'copy' : 'move', d.paths, dir)
    }
  })

  // Cmd/Ctrl+C/X/V on the list: keys, since Chromium sends no clipboard event without a text selection
  const take = (cut: boolean) => {
    const paths = chosen()
    if (paths.length) clip = { host, paths, cut }
  }
  const pasteHere = () => void ((col?.path ?? here) && paste(col?.path ?? here!))

  const keys = (e: React.KeyboardEvent) => {
    const { key } = e
    const cmd = e.metaKey || e.ctrlKey
    if (key === 'F2' && sel) return void (e.preventDefault(), startRename(sel.path))
    if ((cmd && key === 'Backspace') || key === 'Delete') return void (e.preventDefault(), askDelete(chosen()))
    if (cmd && !e.shiftKey && key.toLowerCase() === 'z') return void (e.preventDefault(), runUndo())
    if (cmd && key.toLowerCase() === 'a') return void (e.preventDefault(), selectAll())
    if (cmd && !e.shiftKey && ['c', 'x', 'v'].includes(key.toLowerCase())) {
      e.preventDefault()
      return key.toLowerCase() === 'v' ? pasteHere() : take(key.toLowerCase() === 'x')
    }
    const mod = e.metaKey || e.altKey
    const next = columns[ci + 1]
    let i = mod ? null : listKey(key, at, shown.length)
    if (tiles && !mod && (key === 'ArrowLeft' || key === 'ArrowRight')) i = Math.min(Math.max(at + (key === 'ArrowLeft' ? -1 : 1), 0), shown.length - 1)
    if (tiles && i !== null && (key === 'ArrowUp' || key === 'ArrowDown') && at >= 0) i = Math.min(Math.max(at + (key === 'ArrowUp' ? -1 : 1) * perRow(), 0), shown.length - 1)
    if (i !== null) pick(i, e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown') ? 'range' : 'one')
    else if (view === 'columns' && (key === 'ArrowRight' || (key === 'Enter' && sel?.dir))) next && visible(next)[0] && select(ci + 1, next.path, visible(next)[0])
    else if (view === 'columns' && key === 'ArrowLeft' && ci > 0) setSel({ path: col.path, dir: true }), setCols(c => c.slice(0, ci))
    else if (key === 'Enter' || (key === 'ArrowDown' && mod)) shown[at] && open(child(col.path, shown[at].name), shown[at].dir)
    else if (key === 'Backspace' || (key === 'ArrowUp' && mod)) up()
    else if (key === 'ContextMenu' && shown[at]) menu(e, col.path, shown[at])
    else if (key === ' ') setShowPreview(v => !v)
    else if (key.length === 1 && !e.ctrlKey && !e.metaKey) pick(typeAhead(shown.map(x => x.name), at, key))
    else return
    e.preventDefault()
  }

  const menu = async (e: React.SyntheticEvent, dir: string, entry: DirEntry | null) => {
    e.preventDefault()
    e.stopPropagation()
    const full = entry ? child(dir, entry.name) : dir
    // a right-click outside the selection selects just that entry, like Finder
    if (entry && !picked.has(full)) select(Math.max(0, columns.findIndex(c => c.path === dir)), dir, entry)
    const items = entry ? chosen(full) : []
    const known = knownTags(seenTags())
    const tags = entry && !host ? tagsMenu({ known, has: tagState(items), dots: TAG_HEX.map((h, i) => h || (i ? '' : '#8e8e93')) }) : undefined
    const choice = await popup(
      filesMenu({ target: entry ? (entry.dir ? 'dir' : 'file') : 'background', remote: !!host, count: items.length, paste: clipFor(), tags })
    )
    if (!choice) return
    if (choice === 'newFile' || choice === 'newFolder') return startCreate(choice, full)
    if (choice === 'paste') return paste(full)
    if (choice === 'rename') return startRename(full)
    if (choice === 'duplicate') return transfer('copy', items, dir, true)
    if (choice === 'copy' || choice === 'cut') return void (clip = { host, paths: items, cut: choice === 'cut' })
    if (choice === 'delete') return askDelete(items)
    if (choice?.startsWith('tag:')) return toggleTag(items, known[Number(choice.slice(4))])
    if (choice === 'tags') return setTagging(items)
    if (choice === 'open') return entry && open(full, entry.dir)
    if (choice === 'copyPath') return window.api.clipboardWrite(host ? `${host}:${full}` : full)
    if (choice === 'refresh') return refresh()
    if (choice === 'terminal') return openTerminal(containerApi, { cwd: full, host }, api.id)
    if (choice === 'edit') return openEditor(containerApi, { path: full, host }, api.id)
    if (choice === 'split:right' || choice === 'split:within') openFolder(containerApi, { path: full, host }, api.id, choice === 'split:right' ? 'right' : 'within')
  }

  // one folder's entries, as rows (list), tiles (icons) or a column
  const entriesOf = (l: Col, i: number) => {
    const all = visible(l)
    // click a heading to sort by it, again to reverse
    const head = (key: SortKey, label: string, cls: string) => (
      <span className={cls + (sort.key === key ? ' sorted' : '')} onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : key !== 'name' }))}>
        {label}
        {sort.key === key && (sort.desc ? ' ▾' : ' ▴')}
      </span>
    )
    if (l.error) return <div className="files-error"><pre>{l.error}</pre></div>
    return (
      <>
        {view === 'list' && (
          <div className="files-head">
            {head('name', t('Nome'), 'name')}
            {head('size', t('Dimensione'), 'size')}
            {head('mtime', t('Modificato'), 'date')}
          </div>
        )}
        {editing && editing.kind !== 'rename' && editing.dir === l.path && (
          <div className="file editing">
            {editing.kind === 'newFolder' ? <Folder {...ICON} className="dir" /> : <File {...ICON} />}
            {editBox(editing)}
          </div>
        )}
        {all.slice(0, MAX_SHOWN).map(e => {
          const full = child(l.path, e.name)
          const opened = view === 'columns' && columns[i + 1]?.path === full && full !== sel?.path // the folder shown in the next column
          const renaming = editing?.kind === 'rename' && editing.from === full
          const name = renaming ? (
            editBox(editing)
          ) : (
            <>
              <span className="name">{e.name}</span>
              <TagDots tags={e.tags} />
            </>
          )
          return (
            <div
              key={e.name}
              className={'file' + (e.name.startsWith('.') ? ' hidden' : '') + (full === sel?.path || picked.has(full) ? ' selected' : '') + (opened ? ' opened' : '') + (dropOn === full ? ' drop' : '')}
              onClick={ev => select(i, l.path, e, ev.metaKey || ev.ctrlKey ? 'toggle' : ev.shiftKey ? 'range' : 'one')}
              onDoubleClick={() => open(full, e.dir)}
              draggable={!renaming}
              onDragStart={ev => drag(ev, full)}
              onDragEnd={() => (dragging = null)}
              {...(e.dir ? dropProps(full) : {})}
              onContextMenu={ev => menu(ev, l.path, e)}
              title={tiles ? e.name : t('doppio clic: apri')}
            >
              {tiles ? (
                <>
                  {e.dir ? (
                    <Folder size={36} strokeWidth={1.25} className="dir" />
                  ) : imageType(e.name) ? (
                    <Thumb host={host} path={full} mtime={e.mtime} fallback={<File size={36} strokeWidth={1.25} />} />
                  ) : (
                    <File size={36} strokeWidth={1.25} />
                  )}
                  {name}
                </>
              ) : (
                <>
                  {e.dir ? <Folder {...ICON} className="dir" /> : <File {...ICON} />}
                  {name}
                  {view === 'list' && <span className="size">{e.dir ? '—' : e.size === undefined ? '' : formatSize(e.size)}</span>}
                  {view === 'list' && <span className="date">{e.mtime === undefined ? '' : new Date(e.mtime).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })}</span>}
                  {view === 'columns' && e.dir && <ChevronRight {...ICON} className="chevron" />}
                </>
              )}
            </div>
          )
        })}
        {!all.length && <div className="files-empty">{l.entries.length ? t('Nessun elemento da mostrare') : t('Cartella vuota')}</div>}
        {all.length > MAX_SHOWN && <div className="files-empty">{t('… altri {n} elementi non mostrati', { n: all.length - MAX_SHOWN })}</div>}
      </>
    )
  }

  // where the search box looks: the folder being worked in (in the columns view, the column holding the selection),
  // taken when the search starts or the tile moves to another folder, not when a result is picked (that moves the selection)
  const workDir = error ? null : (col?.path ?? listing?.path ?? null)
  const [searchDir, setSearchDir] = useState<string | null>(null)
  useEffect(() => setSearchDir(q.text ? workDir : null), [!!q.text, listing?.path])

  // the bar's two menus
  const ViewIcon = VIEW_ICON[view]
  // under the button, like a dropdown
  const below = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: Math.round(r.left), y: Math.round(r.bottom + 2) }
  }
  const viewChoice = async (e: React.MouseEvent) => {
    const choice = await popup(viewMenu({ view, hidden, preview: showPreview }), below(e))
    if (choice?.startsWith('view:')) setView(choice.slice(5) as View), setCols([])
    if (choice === 'hidden') setHidden(h => !h)
    if (choice === 'preview') setShowPreview(v => !v)
  }
  const actionChoice = async (e: React.MouseEvent) => {
    const at = below(e)
    const dir = error ? null : (col?.path ?? listing?.path ?? null)
    const choice = await popup(actionsMenu({ ready: !!dir, paste: clipFor() }), at)
    if ((choice === 'newFile' || choice === 'newFolder') && dir) startCreate(choice, dir)
    if (choice === 'paste' && dir) paste(dir)
    if (choice === 'terminal' && dir) openTerminal(containerApi, { cwd: dir, host }, api.id)
    if (choice === 'refresh') refresh()
  }

  // the action bar (Ctrl+Space): what can be done with the selection, then with the folder shown
  const barActions = (): Command[] => {
    const dir = error ? null : (col?.path ?? listing?.path ?? null)
    const items = chosen()
    const one = items.length === 1 ? items[0] : null
    const oneDir = one && sel?.path === one ? sel.dir : false
    const what = one ? nameOf(one) : t('{n} elementi', { n: items.length })
    const onSel: Command[] = !items.length
      ? []
      : [
          ...(one ? [{ label: t('Apri {name}', { name: what }), hint: t('Invio'), run: () => open(one, oneDir), icon: ExternalLink }] : []),
          ...(one && oneDir ? [{ label: t('Apri in un pannello a destra'), run: () => openFolder(containerApi, { path: one, host }, api.id, 'right'), icon: Columns2 }] : []),
          ...(one && !oneDir ? [{ label: t('Modifica nell\'editor'), run: () => openEditor(containerApi, { path: one, host }, api.id), icon: FileCode }] : []),
          ...(one ? [{ label: t('Rinomina'), hint: 'F2', run: () => startRename(one), icon: Pencil }] : []),
          { label: t('Duplica'), run: () => void transfer('copy', items, dirOf(items[0]), true), icon: CopyPlus },
          { label: t('Copia'), hint: 'Cmd+C', run: () => take(false), icon: Copy },
          { label: t('Taglia'), hint: 'Cmd+X', run: () => take(true), icon: Scissors },
          { label: t('Copia percorso'), run: () => void window.api.clipboardWrite(items.map(p => (host ? `${host}:${p}` : p)).join('\n')), icon: Link },
          ...(host ? [] : [{ label: t('Tag…'), run: () => setTagging(items), icon: TagsIcon }]),
          { label: host ? t('Elimina definitivamente…') : t('Sposta nel Cestino'), hint: 'Cmd+⌫', run: () => askDelete(items), icon: Trash2 }
        ].map(c => ({ ...c, group: t('Selezione: {name}', { name: what }) }))
    const onDir: Command[] = [
      ...(dir
        ? [
            { label: t('Nuovo file'), run: () => void startCreate('newFile', dir), icon: FilePlus },
            { label: t('Nuova cartella'), run: () => void startCreate('newFolder', dir), icon: FolderPlus },
            { label: t('Apri terminale qui'), hint: 'Cmd+Alt+T', run: () => openTerminal(containerApi, { cwd: oneDir && one ? one : dir, host }, api.id), icon: SquareTerminal },
            ...(clipFor() === 'ok' ? [{ label: t('Incolla'), hint: 'Cmd+V', run: () => void paste(dir), icon: ClipboardPaste }] : [])
          ]
        : []),
      { label: t('Cerca per nome'), hint: 'Cmd+F', run: () => (set({ mode: 'name' }), setTimeout(() => inputRef.current?.focus())), icon: Search },
      { label: t('Cerca nel contenuto'), run: () => (set({ mode: 'content' }), setTimeout(() => inputRef.current?.focus())), icon: TextSearch },
      ...(host ? [] : [{ label: t('Cerca per tag'), run: () => (set({ mode: 'tag' }), setTimeout(() => inputRef.current?.focus())), icon: ScanSearch }]),
      ...(here && here !== '/' ? [{ label: t('Cartella superiore'), hint: '⌫', run: up, icon: ArrowUp }] : []),
      { label: t('Cartella di base'), run: () => (setSel(null), load(host ? null : (getSettings().filesHome ?? null))), icon: House },
      { label: t('Aggiorna'), run: refresh, icon: RotateCw },
      ...(['list', 'icons', 'columns', 'gallery'] as const).filter(v => v !== view).map(v => ({ label: t('Vista: {name}', { name: t(VIEW_NAME[v]) }), run: () => (setView(v), setCols([])), icon: VIEW_ICON[v] })),
      { label: hidden ? t('Nascondi file nascosti') : t('Mostra file nascosti'), run: () => setHidden(h => !h), icon: hidden ? EyeOff : Eye },
      ...(view !== 'gallery' ? [{ label: showPreview ? t('Nascondi anteprima') : t('Mostra anteprima'), hint: t('Spazio'), run: () => setShowPreview(v => !v), icon: PanelRight }] : [])
    ].map(c => ({ ...c, group: t('Cartella: {name}', { name: here ? baseName(here) || '/' : '~' }) }))
    return [...onSel, ...onDir]
  }
  const barRef = useRef(barActions)
  barRef.current = barActions
  useEffect(() => setTileActions(api.id, () => barRef.current()), [api.id])

  return (
    // Cmd/Ctrl+F: to the search box from anywhere in the tile
    <div ref={rootRef} className="files-tile" onKeyDown={e => (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && (e.preventDefault(), inputRef.current?.focus())}>
      <div className="files-bar">
        <button title={t('Cartella superiore (⌫)')} disabled={!here || here === '/'} onClick={up}>
          <ArrowUp {...ICON} />
        </button>
        <button title={t('Cartella di base')} onClick={() => (setSel(null), load(host ? null : (getSettings().filesHome ?? null)))}>
          <House {...ICON} />
        </button>
        {/* rtl puts the ellipsis on the left, so the end of a long path stays visible; bdi keeps the text itself intact */}
        <span className="files-path" title={here ?? ''}>
          <bdi>
            {host ? `${host}:` : ''}
            {here ?? '~'}
          </bdi>
        </span>
        <button title={t('Vista')} onClick={viewChoice}>
          <ViewIcon {...ICON} /> <ChevronDown size={12} strokeWidth={2} />
        </button>
        <button title={t('Azioni')} onClick={actionChoice}>
          <Ellipsis {...ICON} /> <ChevronDown size={12} strokeWidth={2} />
        </button>
      </div>
      <div className="files-bar search-bar">
        {/* one field, Finder-like: the lens, the text, a clear button; options only where they apply */}
        <label className={'search-field' + (q.text ? ' active' : '')}>
          <Search {...ICON} />
          <input
            ref={inputRef}
            spellCheck={false}
            value={q.text}
            placeholder={q.mode === 'content' ? t('Cerca nel contenuto dei file…') : q.mode === 'tag' ? t('Cerca per tag o colore: Lavoro, rosso…') : t('Cerca per nome: foto, *.pdf, src/**/*.ts…')}
            onChange={e => set({ text: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Escape') set({ text: '' })
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                rootRef.current?.querySelector<HTMLElement>('.files-list')?.focus() // from the box down into the list or the results
              }
            }}
          />
          {q.text && (
            <button className="search-clear" title={t('Svuota (Esc)')} onClick={() => (set({ text: '' }), inputRef.current?.focus())}>
              <X size={12} strokeWidth={2} />
            </button>
          )}
        </label>
        <div className="segmented" role="radiogroup" aria-label={t('Cerca in')}>
          {(host ? (['name', 'content'] as const) : (['name', 'content', 'tag'] as const)).map(m => (
            <button key={m} role="radio" aria-checked={q.mode === m} className={q.mode === m ? 'on' : ''} onClick={() => (set({ mode: m }), inputRef.current?.focus())}>
              {m === 'name' ? t('Nome') : m === 'content' ? t('Contenuto') : t('Tag')}
            </button>
          ))}
        </div>
        <button className={'opt search-opts-btn' + (showOpts ? ' on' : '')} title={t('Opzioni di ricerca')} aria-expanded={showOpts} onClick={() => setShowOpts(v => !v)}>
          <SlidersHorizontal {...ICON} /> {t('Opzioni')}
          {changedOptions(q) > 0 && <span className="opt-badge">{changedOptions(q)}</span>}
        </button>
        {showOpts && <SearchOptions q={q} set={set} onClose={closeOpts} />}
      </div>
      {notice && (
        <div className="files-notice">
          <pre>{notice}</pre>
          <button title={t('Chiudi')} onClick={() => setNotice(null)}>
            <X {...ICON} />
          </button>
        </div>
      )}
      {confirm && <ConfirmDelete {...confirm} onConfirm={doDelete} onCancel={() => (setConfirm(null), listRef.current?.focus())} />}
      {tagging && (
        <TagDialog
          count={tagging.length}
          current={[...new Map(tagging.flatMap(p => entryOf(p)?.tags ?? []).map(x => [x.name, x])).values()]}
          known={knownTags(seenTags())}
          onApply={c => void applyTags(tagging, c)}
          onClose={() => (setTagging(null), listRef.current?.focus())}
        />
      )}
      {conflict && <ConflictDialog names={conflict.names} remote={!!host} onDone={conflict.done} />}
      {error ? (
        <div className="files-error">
          <pre>{error}</pre>
          <button onClick={() => load(target)}>{t('Riprova')}</button>
        </div>
      ) : (
        <div className="files-body">
          {searching && listing ? (
            <FileSearch tileId={api.id} host={host} cwd={searchDir ?? listing.path} q={q} onSelect={path => setSel({ path, dir: false })} onFolder={dir => (set({ text: '' }), load(dir))} onOpen={full => open(full, false)} />
          ) : (
            <div ref={listRef} tabIndex={0} data-autofocus className={`files-list files-${view}` + (loading ? ' loading' : '')} onKeyDown={keys}>
              {view === 'columns'
                ? columns.map((l, i) => (
                    <div key={l.path} className="files-col" onContextMenu={e => menu(e, l.path, null)} {...dropProps(l.path)}>
                      {entriesOf(l, i)}
                    </div>
                  ))
                : listing && (
                    <>
                      {/* the gallery: the selected file big, the folder as a strip of thumbnails below */}
                      {view === 'gallery' && <FilePreview path={sel && !sel.dir ? sel.path : null} preview={preview && preview.path === sel?.path ? preview.p : null} />}
                      <div className="files-entries" onContextMenu={e => menu(e, listing.path, null)} {...dropProps(listing.path)}>
                        {entriesOf(listing, 0)}
                      </div>
                    </>
                  )}
            </div>
          )}
          {showPreview && view !== 'gallery' && <FilePreview path={sel && !sel.dir ? sel.path : null} preview={preview && preview.path === sel?.path ? preview.p : null} />}
        </div>
      )}
      {!error && (
        <StatusBar
          host={host}
          col={col ?? null}
          shown={col ? visible(col) : []}
          hidden={col ? col.entries.length - visible(col).length : 0}
          picked={col ? chosen().flatMap(path => (dirOf(path) === col.path ? col.entries.filter(e => e.name === nameOf(path)).map(entry => ({ path, entry })) : [])) : []}
        />
      )}
    </div>
  )
}

function FilePreview({ path, preview }: { path: string | null; preview: Preview | null }) {
  if (!path) return <div className="files-preview files-empty">{t('Seleziona un file')}</div>
  const head = (
    <div className="files-preview-head" title={path}>
      <bdi>{path.slice(dirOf(path).length + 1)}</bdi>
    </div>
  )
  const body = !preview ? (
    <div className="files-empty">{t('Caricamento…')}</div>
  ) : preview.kind === 'image' ? (
    <img src={preview.src} />
  ) : preview.kind === 'binary' ? (
    <div className="files-empty">{t('File binario')}</div>
  ) : preview.kind === 'error' ? (
    <pre className="files-preview-error">{preview.error}</pre>
  ) : /\.(md|markdown)$/i.test(path) ? (
    // links do nothing here: main never lets the window navigate
    <div className="note-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(preview.text) }} />
  ) : (
    <pre>{preview.text}</pre>
  )
  return (
    <div className="files-preview">
      {head}
      {body}
      {preview?.kind === 'text' && preview.truncated && <div className="files-empty">{t('… anteprima troncata')}</div>}
    </div>
  )
}

// thumbnails already made, by host, path and modification time, so an edited image gets a new one
// ponytail: never trimmed; a few KB each, an LRU if it ever matters
const thumbs = new Map<string, Promise<string | null>>()

const asDataUrl = (b: Blob) => new Promise<string>(ok => {
  const r = new FileReader()
  r.onload = () => ok(r.result as string)
  r.readAsDataURL(b)
})

// a PNG at most `size` px on its longer side, keeping the proportions
async function makeThumb(host: string | null, path: string, size: number): Promise<string | null> {
  const bytes = await window.api.imageBytes(host, path)
  const type = imageType(path)
  if (!bytes || !type) return null
  const blob = new Blob([bytes], { type })
  if (type === 'image/svg+xml') return bytes.length < 1024 * 1024 ? asDataUrl(blob) : null // createImageBitmap does not read SVG; it scales anyway
  try {
    const img = await createImageBitmap(blob) // decoded off the main thread
    const k = Math.min(1, size / Math.max(img.width, img.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.width * k))
    c.height = Math.max(1, Math.round(img.height * k))
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    img.close()
    return c.toDataURL('image/png')
  } catch {
    return null // not an image after all, or a format Chromium cannot read
  }
}

// an image's thumbnail, asked for only once its icon scrolls into view; the plain icon until then or if there is none
function Thumb({ host, path, mtime, fallback }: { host: string | null; path: string; mtime?: number; fallback: React.ReactNode }) {
  const [src, setSrc] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let live = true
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      const key = `${host}:${path}:${mtime}`
      if (!thumbs.has(key)) thumbs.set(key, makeThumb(host, path, 128))
      thumbs.get(key)!.then(s => live && setSrc(s))
    })
    io.observe(ref.current!)
    return () => void ((live = false), io.disconnect())
  }, [host, path, mtime])
  return (
    <div ref={ref} className="thumb">
      {src ? <img src={src} alt="" draggable={false} /> : fallback}
    </div>
  )
}
