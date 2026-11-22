import { useEffect, useRef, useState } from 'react'
import type { Changes, CommitInfo, DiffSpec, DiffTexts, FileChange, GitAction, GitRefs, Worktree } from '../shared/types'
import { Archive, ChevronDown, ChevronRight, Cloud, Eye, EyeOff, Folder, FolderGit2, GitBranch, Minus, Plus, Search, Tag, Undo2, X } from 'lucide-react'
import { filterTree, refTree, type RefNode } from '../shared/gitView'
import { ICON } from './icons'
import { isValidRefName } from '../shared/refName'
import { locale, t } from '../shared/i18n'

// Branches are dragged around as JSON under our own type, so nothing else (files, text) is mistaken for one
export const REF_MIME = 'application/x-cassetto-ref'
export type DragRef = { name: string; remote: boolean }
export type DropTarget = { name: string; kind: 'branch' | 'remote' | 'remoteName' }

export const dragRef = (r: DragRef) => ({
  draggable: true,
  onDragStart: (e: React.DragEvent) => {
    e.dataTransfer.setData(REF_MIME, JSON.stringify(r))
    e.dataTransfer.effectAllowed = 'move'
  }
})
export const dropRef = (onDrop: (r: DragRef) => void) => ({
  onDragOver: (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(REF_MIME)) return
    e.preventDefault()
    e.currentTarget.classList.add('drop-over')
  },
  onDragLeave: (e: React.DragEvent) => e.currentTarget.classList.remove('drop-over'),
  onDrop: (e: React.DragEvent) => {
    e.currentTarget.classList.remove('drop-over')
    const d = e.dataTransfer.getData(REF_MIME)
    if (!d) return
    e.preventDefault()
    e.stopPropagation() // not a file drop
    onDrop(JSON.parse(d))
  }
})

const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

// open/onToggle make it controlled (the sidebar remembers it); without them it keeps its own state
function Section({ title, count, children, extra, ...c }: { title: string; count: number; open?: boolean; onToggle?: () => void; children: React.ReactNode; extra?: React.ReactNode }) {
  const [own, setOwn] = useState(true)
  const open = c.open ?? own
  const onToggle = c.onToggle ?? (() => setOwn(!own))
  return (
    <div className="git-section">
      <div className="git-section-head" onClick={onToggle}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{title}</span>
        <span className="count">{count}</span>
        {extra}
      </div>
      {open && children}
    </div>
  )
}

const leaves = <T,>(ns: RefNode<T>[]): number => ns.reduce((n, x) => n + (x.kind === 'leaf' ? 1 : leaves(x.children)), 0)

// a branch tree: folders open and close, leaves are drawn by the caller
function Tree<T>({ nodes, depth, scope, isOpen, onToggle, leaf }: { nodes: RefNode<T>[]; depth: number; scope: string; isOpen: (key: string) => boolean; onToggle: (key: string) => void; leaf: (item: T, label: string, depth: number) => React.ReactNode }) {
  return (
    <>
      {nodes.map(n => {
        if (n.kind === 'leaf') return leaf(n.item, n.label, depth)
        const key = `folder:${scope}:${n.path}`
        const open = isOpen(key)
        return (
          <div key={key}>
            <div className="git-item folder" style={{ paddingLeft: 10 + depth * 12 }} onClick={() => onToggle(key)}>
              {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Folder size={12} />
              <span className="name">{n.label}</span>
              <span className="count">{leaves(n.children)}</span>
            </div>
            {open && <Tree nodes={n.children} depth={depth + 1} scope={scope} isOpen={isOpen} onToggle={onToggle} leaf={leaf} />}
          </div>
        )
      })}
    </>
  )
}

export type SideItem = { name: string; kind: 'branch' | 'remote' | 'tag' } | { stash: number; sha: string } | { worktree: Worktree }

// branches, remotes, tags and stashes: click finds it in the graph, double click checks it out
export function GitSidebar(p: {
  refs: GitRefs
  current: string | null
  selected: string | null
  collapsed: string[]
  onToggle: (key: string) => void
  hidden: string[]
  onToggleHidden: (ref: string) => void
  onPick: (sha: string) => void
  onOpen: (name: string, remote: boolean) => void
  onMenu: (e: React.MouseEvent, item: SideItem) => void
  onDrop: (source: DragRef, target: DropTarget) => void
  onOpenWorktree: (w: Worktree) => void
}) {
  const { refs, current } = p
  const [q, setQ] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)
  const has = (name: string) => name.toLowerCase().includes(q.trim().toLowerCase())
  // while filtering everything is open, so a match is never hidden in a closed folder
  const isOpen = (key: string) => !!q.trim() || !p.collapsed.includes(key)
  const row = (key: string, sha: string, item: SideItem, body: React.ReactNode, extra: object = {}, depth = 0) => (
    <div key={key} className={'git-item' + (sha === p.selected ? ' sel' : '') + ('kind' in item && p.hidden.includes((item.kind === 'remote' ? 'refs/remotes/' : 'refs/heads/') + item.name) && item.kind !== 'tag' ? ' hidden-ref' : '')} style={depth ? { paddingLeft: 18 + depth * 12 } : undefined} onClick={() => p.onPick(sha)} onContextMenu={e => (e.preventDefault(), p.onMenu(e, item))} {...extra}>
      {body}
    </div>
  )
  // an eye on branch rows: hide it from the graph or bring it back
  const eye = (ref: string) => {
    const off = p.hidden.includes(ref)
    return (
      <span className={'eye' + (off ? ' off' : '')} title={off ? t('Mostra nel grafo') : t('Nascondi dal grafo')} onClick={e => (e.stopPropagation(), p.onToggleHidden(ref))} onDoubleClick={e => e.stopPropagation()}>
        {off ? <EyeOff size={12} /> : <Eye size={12} />}
      </span>
    )
  }
  const local = filterTree(refTree(refs.branches), q, b => b.name)
  const tags = refs.tags.filter(t => has(t.name))
  const stashes = refs.stashes.filter(s => has(s.message))
  const worktrees = refs.worktrees.filter(w => has(w.branch ?? ''))
  // sections remember their state under a fixed key, whatever the language
  const sec = (id: string) => ({ open: isOpen(`section:${id}`), onToggle: () => p.onToggle(`section:${id}`) })
  return (
    <div
      className="git-sidebar"
      tabIndex={-1} // a click on a row keeps the focus here, so ⌘F reaches the filter
      onKeyDown={e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') (e.preventDefault(), filterRef.current?.focus(), filterRef.current?.select())
      }}
    >
      <div className="git-filter">
        <Search size={12} />
        <input ref={filterRef} value={q} placeholder={t('Filtra rami, tag…')} spellCheck={false} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Escape' && (e.stopPropagation(), setQ(''))} />
        {q && <X size={12} className="clear" onClick={() => setQ('')} />}
      </div>
      <Section title={t('Locali')} count={leaves(local)} {...sec('Locali')}>
        <Tree
          nodes={local}
          depth={0}
          scope="local"
          isOpen={isOpen}
          onToggle={p.onToggle}
          leaf={(b, label, depth) =>
            row(
              b.name,
              b.sha,
              { name: b.name, kind: 'branch' },
              <>
                <GitBranch size={12} className={b.name === current ? 'current' : ''} />
                <span className={'name' + (b.name === current ? ' current' : '')}>{label}</span>
                {b.track && <span className="track">{b.track.replace(/ahead (\d+)/, '↑$1').replace(/behind (\d+)/, '↓$1').replace(/[[\],]/g, '')}</span>}
                {eye(`refs/heads/${b.name}`)}
              </>,
              { title: `${b.name}\n${b.upstream ? `→ ${b.upstream}` : t('nessun upstream')}`, onDoubleClick: () => p.onOpen(b.name, false), ...dragRef({ name: b.name, remote: false }), ...dropRef(s => p.onDrop(s, { name: b.name, kind: 'branch' })) },
              depth
            )
          }
        />
      </Section>
      <Section title={t('Remoti')} count={refs.remotes.length} {...sec('Remoti')}>
        {refs.remotes.map(r => {
          const tree = filterTree(refTree(refs.remoteBranches.filter(b => b.name.startsWith(r + '/')), r + '/'), q, b => b.name)
          if (q.trim() && !tree.length) return null
          const key = `remote:${r}`
          return (
            <div key={r}>
              {/* a remote takes a dropped branch: push it there */}
              <div className="git-item remote-name" title={t('Trascina qui un ramo per il push su {remote}', { remote: r })} onClick={() => p.onToggle(key)} {...dropRef(s => p.onDrop(s, { name: r, kind: 'remoteName' }))}>
                {isOpen(key) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Cloud size={12} />
                <span className="name">{r}</span>
                <span className="count">{leaves(tree)}</span>
              </div>
              {isOpen(key) && (
                <Tree
                  nodes={tree}
                  depth={1}
                  scope={r}
                  isOpen={isOpen}
                  onToggle={p.onToggle}
                  leaf={(b, label, depth) =>
                    row(
                      b.name,
                      b.sha,
                      { name: b.name, kind: 'remote' },
                      <>
                        <span className="name">{label}</span>
                        {eye(`refs/remotes/${b.name}`)}
                      </>,
                      { title: b.name, onDoubleClick: () => p.onOpen(b.name, true), ...dragRef({ name: b.name, remote: true }), ...dropRef(s => p.onDrop(s, { name: b.name, kind: 'remote' })) },
                      depth
                    )
                  }
                />
              )}
            </div>
          )
        })}
      </Section>
      <Section title={t('Tag')} count={tags.length} {...sec('Tag')}>
        {tags.map(tag => row(tag.name, tag.sha, { name: tag.name, kind: 'tag' }, <><Tag size={12} /><span className="name">{tag.name}</span></>))}
      </Section>
      {worktrees.length > 0 && (
        <Section title={t('Worktree')} count={worktrees.length} {...sec('Worktree')}>
          {worktrees.map(w => row(`wt${w.path}`, w.sha, { worktree: w }, <><FolderGit2 size={12} /><span className="name">{w.branch ?? '(detached)'}</span></>, { title: `${w.path}\n${t('doppio clic: apri la cartella in un tab')}`, onDoubleClick: () => p.onOpenWorktree(w) }))}
        </Section>
      )}
      <Section title={t('Stash')} count={stashes.length} {...sec('Stash')}>
        {stashes.map(s => row(`stash${s.index}`, s.sha, { stash: s.index, sha: s.sha }, <><Archive size={12} /><span className="name">{s.message}</span></>, { title: `stash@{${s.index}}` }))}
      </Section>
    </div>
  )
}

function FileRow(p: { f: FileChange; active: boolean; onClick: () => void; onMenu?: (e: React.MouseEvent) => void; buttons?: React.ReactNode; onDoubleClick?: () => void }) {
  const { f } = p
  return (
    <div className={'git-file' + (p.active ? ' sel' : '')} onClick={p.onClick} onDoubleClick={p.onDoubleClick} onContextMenu={p.onMenu && (e => (e.preventDefault(), p.onMenu!(e)))} title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}>
      <span className={`st st-${f.status === '?' ? 'new' : f.status}`}>{f.status === '?' ? 'N' : f.status}</span>
      <span className="name">{baseOf(f.path)}</span>
      <span className="dir">{dirOf(f.path)}</span>
      {p.buttons && <span className="git-file-buttons">{p.buttons}</span>}
    </div>
  )
}

const sameDiff = (a: DiffSpec | null, kind: DiffSpec['kind'], path: string) => !!a && a.kind === kind && a.path === path

// the working tree: what changed, what is staged, and the commit box
export function ChangesPanel(p: {
  changes: Changes
  busy: boolean
  diff: DiffSpec | null
  lastMessage: () => Promise<string>
  onDiff: (d: DiffSpec) => void
  onRun: (label: string, ...a: GitAction[]) => Promise<boolean>
  onMenu: (e: React.MouseEvent, f: FileChange, staged: boolean) => void
}) {
  const { changes } = p
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const stage = (fs: FileChange[]) => fs.length && p.onRun('stage', { op: 'stage', paths: fs.map(f => f.path) })
  const unstage = (fs: FileChange[]) => fs.length && p.onRun('unstage', { op: 'unstage', paths: fs.flatMap(f => (f.oldPath ? [f.oldPath, f.path] : [f.path])) })
  const discard = (f: FileChange) => {
    const untracked = f.status === '?'
    if (confirm(untracked ? t('Eliminare {path}? Il file non è tracciato da git: non si potrà recuperare.', { path: f.path }) : t('Scartare le modifiche a {path}? Non si potranno recuperare.', { path: f.path })))
      p.onRun('discard', { op: 'discard', paths: [f.path], untracked })
  }
  const toggleAmend = async () => {
    const on = !amend
    setAmend(on)
    if (on && !message.trim()) setMessage(await p.lastMessage()) // amending usually starts from the last message
  }
  const canCommit = !!message.trim() && (changes.staged.length > 0 || amend) && !p.busy
  const commit = async () => {
    if (!canCommit) return
    if (await p.onRun('commit', { op: 'commit', message: message.trim(), amend })) (setMessage(''), setAmend(false))
  }
  return (
    <div className="git-changes-panel">
      <div className="git-files">
        <Section title={t('Modifiche')} count={changes.unstaged.length} extra={changes.unstaged.length > 0 && <button className="git-mini" title={t('Metti tutto in stage')} onClick={e => (e.stopPropagation(), stage(changes.unstaged))}>{t('Stage tutto')}</button>}>
          {changes.unstaged.map(f => (
            <FileRow
              key={f.path}
              f={f}
              active={sameDiff(p.diff, 'unstaged', f.path)}
              onClick={() => p.onDiff({ kind: 'unstaged', path: f.path })}
              onDoubleClick={() => stage([f])}
              onMenu={e => p.onMenu(e, f, false)}
              buttons={
                <>
                  <button title={f.status === '?' ? t('Elimina il file') : t('Scarta le modifiche')} onClick={e => (e.stopPropagation(), discard(f))}>
                    <Undo2 size={12} />
                  </button>
                  <button title={t('Metti in stage')} onClick={e => (e.stopPropagation(), stage([f]))}>
                    <Plus size={12} />
                  </button>
                </>
              }
            />
          ))}
        </Section>
        <Section title={t('In stage')} count={changes.staged.length} extra={changes.staged.length > 0 && <button className="git-mini" title={t('Togli tutto dallo stage')} onClick={e => (e.stopPropagation(), unstage(changes.staged))}>{t('Togli tutto')}</button>}>
          {changes.staged.map(f => (
            <FileRow
              key={f.path}
              f={f}
              active={sameDiff(p.diff, 'staged', f.path)}
              onClick={() => p.onDiff({ kind: 'staged', path: f.path, ...(f.oldPath ? { oldPath: f.oldPath } : {}) })}
              onDoubleClick={() => unstage([f])}
              onMenu={e => p.onMenu(e, f, true)}
              buttons={
                <button title={t('Togli dallo stage')} onClick={e => (e.stopPropagation(), unstage([f]))}>
                  <Minus size={12} />
                </button>
              }
            />
          ))}
        </Section>
      </div>
      <div className="git-commit-box">
        <textarea
          value={message}
          placeholder={t('Messaggio del commit\n\n(Cmd+Invio per il commit)')}
          spellCheck={false}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && (e.preventDefault(), void commit())}
        />
        <div className="git-commit-row">
          <label>
            <input type="checkbox" checked={amend} onChange={toggleAmend} /> Amend
          </label>
          <button className="primary" disabled={!canCommit} onClick={commit} title={changes.staged.length || amend ? '' : t('Nessun file in stage')}>
            {amend ? 'Amend' : `Commit${changes.staged.length ? ` (${changes.staged.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CommitDetails({ info, diff, onDiff, onCopy, onMenu }: { info: CommitInfo; diff: DiffSpec | null; onDiff: (d: DiffSpec) => void; onCopy: (s: string) => void; onMenu: (e: React.MouseEvent, f: FileChange) => void }) {
  const [subject, ...body] = info.message.split('\n')
  return (
    <div className="git-details">
      <div className="git-details-head">
        <div className="subject">{subject}</div>
        {body.join('\n').trim() && <pre className="body">{body.join('\n').trim()}</pre>}
        <div className="meta">
          <span title={info.email}>{info.author}</span> · {new Date(info.time * 1000).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })}
        </div>
        <div className="meta sha" title={t('Clic per copiare')} onClick={() => onCopy(info.sha)}>
          {info.sha}
        </div>
      </div>
      <Section title={t('File')} count={info.files.length}>
        {info.files.map(f => (
          <FileRow key={f.path} f={f} active={sameDiff(diff, 'commit', f.path) && (diff as { sha: string }).sha === (f.from ?? info.sha)} onClick={() => onDiff({ kind: 'commit', sha: f.from ?? info.sha, path: f.path, ...(f.oldPath ? { oldPath: f.oldPath } : {}) })} onMenu={e => onMenu(e, f)} />
        ))}
      </Section>
    </div>
  )
}

// a file's two sides, read-only; it takes the graph's place until closed
// ponytail: plain text of both sides, a real side-by-side diff replaces this body
export function DiffView({ cwd, spec, onClose }: { cwd: string; spec: DiffSpec; onClose: () => void }) {
  const [texts, setTexts] = useState<DiffTexts | null>(null)
  useEffect(() => {
    let live = true
    setTexts(null)
    window.api.gitDiff(cwd, spec).then(r => live && setTexts(r))
    return () => void (live = false)
  }, [cwd, JSON.stringify(spec)])
  const what = spec.kind === 'commit' ? spec.sha.slice(0, 8) : spec.kind === 'staged' ? t('in stage') : t('modifiche')
  return (
    <div className="git-diff" onKeyDown={e => e.key === 'Escape' && onClose()}>
      <div className="git-diff-head">
        <span className="name">{spec.path}</span>
        <span className="what">{what}</span>
        <button title={t('Chiudi (Esc)')} onClick={onClose}>
          <X {...ICON} />
        </button>
      </div>
      {!texts ? (
        <div className="git-empty">{t('Caricamento…')}</div>
      ) : !texts.ok ? (
        <div className="git-empty">{texts.error}</div>
      ) : (
        <pre className="git-diff-box">{`--- a/${spec.path}\n${texts.original}\n+++ b/${spec.path}\n${texts.modified}`}</pre>
      )}
    </div>
  )
}

// asks for a name: a branch (checked as a ref name) or free text such as a stash message
export function NameDialog(p: {
  title: string
  label: string
  initial?: string
  isRef?: boolean
  optional?: boolean
  check?: string // a checkbox, e.g. "Checkout del nuovo ramo"
  confirmLabel: string
  onConfirm: (name: string, checked: boolean) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(p.initial ?? '')
  const [checked, setChecked] = useState(true)
  const valid = p.isRef ? isValidRefName(name) : p.optional || !!name.trim()
  const ok = () => valid && p.onConfirm(name.trim(), checked)
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && p.onCancel()}>
      <div className="dialog" onKeyDown={e => e.key === 'Escape' && p.onCancel()}>
        <h3>{p.title}</h3>
        <label>{p.label}</label>
        <input autoFocus value={name} onFocus={e => e.target.select()} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && ok()} />
        {p.isRef && name && !valid && <div className="error">{t('Nome non valido')}</div>}
        {p.check && (
          <label className="check">
            <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> {p.check}
          </label>
        )}
        <div className="actions">
          <button onClick={p.onCancel}>{t('Annulla')}</button>
          <button className="primary" disabled={!valid} onClick={ok}>
            {p.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
