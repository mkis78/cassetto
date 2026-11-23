import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import { layoutGraph, reachable, type GraphRow } from '../shared/graph'
import type { Changes, Commit, CommitInfo, DiffSpec, FileChange, GitAction, GitParams, GitRefs, GitStatus, Ref } from '../shared/types'
import { Archive, ArchiveRestore, Search, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpFromLine, GitBranch, PanelLeft, RefreshCw, RotateCw, Tag, X } from 'lucide-react'
import { TagDialog } from './GitDialogs'
import { ChangesPanel, CommitDetails, DiffView, dragRef, dropRef, GitSidebar, NameDialog, type DragRef, type DropTarget, type SideItem } from './GitPanels'
import { ICON } from './icons'
import { claudeTarget, openClaude, openEditor, openFolder, openTerminal, sendToClaude } from './tiles'
import { listKey } from '../shared/listNav'
import { matchCommit, nextMatch } from '../shared/gitView'
import { changeMenu, commitMenu, dropMenu, fileRefMenu, refMenu, stashMenu, worktreeMenu } from '../shared/menus'
import { popup } from './menuIcons'
import { setModule, useModule } from './modules'
import { locale, t } from '../shared/i18n'

const ROW = 24
const LANE = 14
const COLORS = ['#7daea3', '#89b482', '#d8a657', '#d3869b', '#e78a4e', '#a9b665', '#ea6962', '#83a598']
const color = (lane: number) => COLORS[lane % COLORS.length]
const x = (lane: number) => lane * LANE + LANE / 2 + 2

function ago(unix: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - unix)
  if (s < 60) return t('ora')
  if (s < 3600) return t('{n} min fa', { n: Math.floor(s / 60) })
  if (s < 86400) return t('{n} h fa', { n: Math.floor(s / 3600) })
  if (s < 86400 * 30) return t('{n} g fa', { n: Math.floor(s / 86400) })
  return new Date(unix * 1000).toLocaleDateString(locale())
}

function Lanes({ row, merge, width }: { row: GraphRow; merge: boolean; width: number }) {
  return (
    <svg className="lanes" width={width * LANE + 4} height={ROW}>
      {row.edges.map(({ from, to }) => (
        <path
          key={`${from}-${to}`}
          d={from === to ? `M${x(from)} ${ROW / 2} V${ROW * 1.5}` : `M${x(from)} ${ROW / 2} C${x(from)} ${ROW * 1.1}, ${x(to)} ${ROW * 0.9}, ${x(to)} ${ROW * 1.5}`}
          stroke={color(Math.max(from, to))}
          strokeWidth={2}
          fill="none"
        />
      ))}
      <circle cx={x(row.lane)} cy={ROW / 2} r={4.5} style={{ fill: merge ? 'var(--bg)' : color(row.lane) }} stroke={color(row.lane)} strokeWidth={2} />
    </svg>
  )
}

// a branch or tag on a commit; branches can be dragged onto each other (merge, rebase) or onto a remote (push)
function RefBadge({ r, onClick, onDoubleClick, onMenu, onDrop }: { r: Ref; onClick?: (e: React.MouseEvent) => void; onDoubleClick?: () => void; onMenu?: (e: React.MouseEvent) => void; onDrop?: (s: DragRef) => void }) {
  const branch = r.kind !== 'tag' && r.name !== 'HEAD'
  return (
    <span
      className={'ref ' + r.kind}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onMenu && (e => (e.preventDefault(), e.stopPropagation(), onMenu(e)))}
      title={r.kind === 'tag' ? t('tag') : t('doppio clic: checkout · trascina su un altro ramo: merge o rebase')}
      {...(branch ? dragRef({ name: r.name, remote: r.kind === 'remote' }) : {})}
      {...(branch && onDrop ? dropRef(onDrop) : {})}
    >
      {r.kind === 'tag' ? <Tag size={11} strokeWidth={2} /> : r.kind === 'head' ? <span className="head-dot" /> : null}
      {r.name}
    </span>
  )
}

// which ref a commit shows first in the branch column
const RANK: Record<Ref['kind'], number> = { head: 0, branch: 1, remote: 2, tag: 3 }

type Dialog = { kind: 'tag'; commit: Commit } | { kind: 'branch'; sha: string; label: string } | { kind: 'rename'; name: string } | { kind: 'stash' } | null

// a repository in its own tab; off while the Git compartment is switched off
export default function GitTile(props: IDockviewPanelProps<GitParams>) {
  const on = useModule('git')
  if (!on)
    return (
      <div className="files-empty">
        {t('Lo scomparto Git è disattivato')} <button onClick={() => setModule('git', true)}>{t('Attiva')}</button>
      </div>
    )
  return <Repo {...props} />
}

function Repo({ params, api, containerApi }: IDockviewPanelProps<GitParams>) {
  const { cwd } = params
  const claudeOn = useModule('claude') // a worktree's double click opens a Claude there
  const [log, setLog] = useState<Commit[]>([])
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [refs, setRefs] = useState<GitRefs>({ branches: [], remoteBranches: [], tags: [], remotes: [], stashes: [], worktrees: [] })
  const [changes, setChanges] = useState<Changes>({ staged: [], unstaged: [] })
  const [busy, setBusy] = useState<string | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null) // a commit's sha; null = the working tree
  const [info, setInfo] = useState<CommitInfo | null>(null)
  const [diff, setDiff] = useState<DiffSpec | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  // how the tab was left lives in its params, so it comes back with the layout
  const [sidebar, setSidebar] = useState(params.sidebar ?? true)
  useEffect(() => void api.updateParameters({ sidebar }), [sidebar])
  // closed sections and folders in the sidebar; tags start closed, there are usually many
  const [collapsed, setCollapsed] = useState(params.collapsed ?? ['section:Tag'])
  useEffect(() => void api.updateParameters({ collapsed }), [collapsed])
  // what the graph shows: one ref alone, or all but the hidden ones (full refnames, refs/heads/x)
  const [solo, setSolo] = useState(params.solo ?? null)
  const [hidden, setHidden] = useState(params.hidden ?? [])
  const [limit, setLimit] = useState(500)
  useEffect(() => void api.updateParameters({ solo, hidden }), [solo, hidden])
  const toggleHidden = (ref: string) => setHidden(h => (h.includes(ref) ? h.filter(r => r !== ref) : [...h, ref]))
  // the branch column left of the graph, as wide as the user dragged it
  const [refsWidth, setRefsWidth] = useState(params.refsWidth ?? 150)
  const resizeRefs = (e: React.PointerEvent) => {
    const x0 = e.clientX
    const w0 = refsWidth
    let w = w0
    const move = (m: PointerEvent) => setRefsWidth((w = Math.min(400, Math.max(60, w0 + m.clientX - x0))))
    const up = () => (window.removeEventListener('pointermove', move), window.removeEventListener('pointerup', up), api.updateParameters({ refsWidth: w }))
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // a picked branch lights up its history, the rest fades
  const [highlight, setHighlight] = useState<string | null>(null)
  // commit search: null = closed
  const [search, setSearch] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const toggle = (key: string) => setCollapsed(c => (c.includes(key) ? c.filter(k => k !== key) : [...c, key]))

  const seq = useRef(0)
  const [tick, setTick] = useState(0) // bumps on each refresh, for the open diff
  const noGit = status?.error === 'no-git'
  const refresh = useCallback(async () => {
    const n = ++seq.current
    const s = await window.api.gitStatus(cwd)
    if (n !== seq.current) return // a newer refresh (e.g. after an action) already started
    if (!s.repo) return setStatus(s) // the rest would only fail, several git runs every time
    const [l, r, c] = await Promise.all([window.api.gitLog(cwd, { solo, hidden, limit }), window.api.gitRefs(cwd), window.api.gitChanges(cwd)])
    if (n !== seq.current) return
    setLog(l)
    setStatus(s)
    setRefs(r)
    setChanges(c)
    setTick(n => n + 1)
  }, [cwd, solo, hidden, limit])

  // git runs only while the tab is on screen: a background tab costs nothing, and coming back shows the news at once
  const rootRef = useRef<HTMLDivElement>(null)
  const shown = useRef(true)
  useEffect(() => {
    refresh()
    const io = new IntersectionObserver(([e]) => {
      const was = shown.current
      shown.current = e.isIntersecting
      if (!was && e.isIntersecting) refresh()
    })
    if (rootRef.current) io.observe(rootRef.current)
    const tick = () => shown.current && !document.hidden && refresh()
    // without git, every run of the macOS stub asks again to install the tools (and cancelling refocuses us): only Riprova checks again
    if (noGit) return () => io.disconnect()
    const timer = setInterval(tick, 10_000)
    window.addEventListener('focus', tick)
    return () => (io.disconnect(), clearInterval(timer), window.removeEventListener('focus', tick))
  }, [refresh, !!status?.repo, noGit])

  // the selected commit's details; a stash is a commit too, though not in the graph
  useEffect(() => {
    setInfo(null)
    if (!selected) return
    let live = true
    window.api.gitCommit(cwd, selected).then(i => live && setInfo(i))
    return () => void (live = false)
  }, [selected, cwd])

  const busyRef = useRef(false) // menus, drops and double clicks must not start a second git command
  // null: another command is running and this one did not start
  const run = async (label: string, ...actions: GitAction[]): Promise<boolean | null> => {
    if (busyRef.current) return null
    busyRef.current = true
    setBusy(label)
    setOutput(null)
    let ok = true
    for (const a of actions) {
      const r = await window.api.gitRun(cwd, a)
      if (!r.ok) {
        setOutput(r.output)
        ok = false
        break
      }
    }
    busyRef.current = false
    setBusy(null)
    if (ok && actions.some(a => a.op === 'commit')) setDiff(d => (d?.kind === 'commit' ? d : null)) // what it showed is in the commit now
    refresh()
    return ok
  }

  const rows = useMemo(() => layoutGraph(log), [log])
  const lit = useMemo(() => (highlight ? reachable(log, highlight) : null), [log, highlight])
  // one width for every row so subjects line up; very wide histories are clipped
  const graphWidth = Math.min(20, Math.max(1, ...rows.map(r => r.width)))
  const current = status?.branch ?? null
  const dirty = changes.staged.length + changes.unstaged.length
  const dirtyNote = dirty ? '\n\n' + t('Ci sono {n} file modificati non committati: se qualcosa va in conflitto, annullare potrebbe non ripristinarli.', { n: dirty }) : ''
  const switching = (branch: string) => (branch !== current ? '\n\n' + t('Prima verrà fatto il checkout di {branch}.', { branch }) : '')
  const localName = (name: string, remote: boolean) => (remote ? name.slice(name.indexOf('/') + 1) : name)
  const fullRef = (name: string, kind: 'branch' | 'remote' | 'tag') => (kind === 'branch' ? 'refs/heads/' : kind === 'remote' ? 'refs/remotes/' : 'refs/tags/') + name
  const isRemote = (name: string) => refs.remoteBranches.some(b => b.name === name)

  // switch: a remote branch becomes a local one tracking it
  const checkout = (name: string, remote: boolean) => localName(name, remote) !== current && run('checkout', { op: 'checkout', branch: localName(name, remote) })
  // merge `source` into `target`, checking `target` out first when needed
  const mergeInto = (source: string, target: string) => {
    if (!confirm(t('Merge di {source} in {target}?', { source, target }) + switching(target) + dirtyNote)) return
    run('merge', ...(target !== current ? [{ op: 'checkout' as const, branch: target }] : []), { op: 'merge', ref: source })
  }
  const rebaseOnto = (branch: string, onto: string) => {
    if (!confirm(t('Rebase di {branch} su {onto}? I commit di {branch} vengono riscritti: se erano già stati pubblicati servirà un push forzato.', { branch, onto }) + switching(branch) + dirtyNote)) return
    run('rebase', ...(branch !== current ? [{ op: 'checkout' as const, branch }] : []), { op: 'rebase', onto })
  }
  const push = (branch: string, remote: string) => confirm(t('Push di {branch} su {remote}?', { branch, remote })) && run('push', { op: 'pushBranch', branch, remote })

  const onDrop = async (s: DragRef, target: DropTarget) => {
    if (s.name === target.name) return
    const items = dropMenu({ source: s.name, sourceRemote: s.remote, target: target.name, targetKind: target.kind })
    if (!items.length) return
    const choice = await popup(items)
    if (choice === 'merge') mergeInto(s.name, target.name)
    if (choice === 'mergeInto:source') mergeInto(target.name, s.name)
    if (choice === 'rebase') rebaseOnto(s.name, target.name)
    if (choice === 'push') push(s.name, target.name)
  }

  const commitAction = async (c: Commit) => {
    const branches = c.refs.filter(r => r.kind === 'branch' || r.kind === 'remote' || (r.kind === 'head' && r.name !== 'HEAD')).map(r => r.name)
    const choice = await popup(commitMenu({ current, branches, merge: c.parents.length > 1 }))
    if (!choice) return
    const colon = choice.indexOf(':') // "merge:origin/feat": the action, then what it acts on
    const [what, arg] = colon < 0 ? [choice, ''] : [choice.slice(0, colon), choice.slice(colon + 1)]
    const short = c.sha.slice(0, 8)
    if (choice === 'branch') return setDialog({ kind: 'branch', sha: c.sha, label: `${short} · ${c.subject}` })
    if (choice === 'tag') return setDialog({ kind: 'tag', commit: c })
    if (choice === 'copySha') return window.api.clipboardWrite(c.sha)
    if (choice === 'cherryPick') return confirm(t('Cherry-pick di {sha} "{subject}" su {branch}?', { sha: short, subject: c.subject, branch: current ?? 'HEAD' })) && run('cherry-pick', { op: 'cherryPick', sha: c.sha })
    if (choice === 'revert') return confirm(t('Creare un commit che annulla {sha} "{subject}"?', { sha: short, subject: c.subject })) && run('revert', { op: 'revert', sha: c.sha })
    if (what === 'checkout') return checkout(arg, isRemote(arg))
    if (what === 'merge' && current) return mergeInto(arg, current)
    if (what === 'rebase' && current) return rebaseOnto(current, arg)
    if (what === 'reset') {
      const mode = arg as 'soft' | 'mixed' | 'hard'
      const lose = mode === 'hard' ? '\n\n' + t('ATTENZIONE: le modifiche non committate ({n} file) andranno perse.', { n: dirty }) : ''
      return confirm(t('Reset {mode} di {branch} a {sha} "{subject}"? I commit successivi non saranno più sul ramo.', { mode, branch: current ?? 'HEAD', sha: short, subject: c.subject }) + lose) && run('reset', { op: 'reset', sha: c.sha, mode })
    }
  }

  const sideAction = async (_e: React.MouseEvent, item: SideItem) => {
    if ('worktree' in item) {
      const w = item.worktree
      const choice = await popup(worktreeMenu())
      if (choice === 'folder') return openFolder(containerApi, { path: w.path, host: null }, api.id)
      if (choice === 'copyPath') return window.api.clipboardWrite(w.path)
      if (choice === 'removeWorktree') {
        if (!confirm(t('Rimuovere il worktree {path}? Il ramo {branch} resta: per portarne i commit altrove, trascinalo su un altro ramo.', { path: w.path, branch: w.branch ?? '' }))) return
        if ((await run('worktree', { op: 'worktreeRemove', path: w.path, force: false })) !== false) return
        // git refused: there are changes inside
        if (confirm(t('Il worktree contiene modifiche non committate. Rimuoverlo comunque? Quelle modifiche andranno perse.'))) run('worktree', { op: 'worktreeRemove', path: w.path, force: true })
      }
      return
    }
    if ('stash' in item) {
      const choice = await popup(stashMenu())
      if (choice === 'apply') run('stash', { op: 'stashApply', index: item.stash })
      if (choice === 'pop') run('stash', { op: 'stashPop', index: item.stash })
      if (choice === 'drop' && confirm(t('Eliminare lo stash@{{n}}? Non si potrà recuperare.', { n: item.stash }))) run('stash', { op: 'stashDrop', index: item.stash })
      return
    }
    const { name, kind } = item
    const full = fullRef(name, kind)
    const choice = await popup(refMenu({ name, kind, current, remotes: refs.remotes, hidden: hidden.includes(full) }))
    if (!choice) return
    if (choice === 'solo') return setSolo(full)
    if (choice === 'hide' || choice === 'show') return toggleHidden(full)
    if (choice === 'copy') return window.api.clipboardWrite(name)
    if (choice === 'checkout') return checkout(name, kind === 'remote')
    if (choice === 'merge' && current) return mergeInto(name, current)
    if (choice === 'rebase' && current) return rebaseOnto(current, name)
    if (choice.startsWith('push:')) return push(name, choice.slice(5))
    if (choice === 'rename') return setDialog({ kind: 'rename', name })
    if (choice === 'delete') {
      if (!confirm(t('Eliminare il ramo {name}?', { name }))) return
      if ((await run('delete', { op: 'deleteBranch', name, force: false })) !== false) return
      // not merged anywhere: git refused, ask once more before losing its commits
      if (confirm(t('{name} contiene commit non uniti ad altri rami. Eliminarlo comunque? Quei commit non saranno più raggiungibili.', { name }))) run('delete', { op: 'deleteBranch', name, force: true })
      return
    }
    if (choice === 'deleteRemote') {
      const remote = name.slice(0, name.indexOf('/'))
      if (confirm(t('Eliminare il ramo {name} da {remote}? Sparisce per tutti quelli che usano il repository.', { name: localName(name, true), remote }))) run('delete', { op: 'deleteRemoteBranch', remote, name: localName(name, true) })
    }
  }

  const inRepo = (path: string) => `${cwd.replace(/\/$/, '')}/${path}`
  const edit = (path: string) => openEditor(containerApi, { path: inRepo(path), host: null }, api.id)
  // open, copy: what any file shown in the tab offers
  const refAction = (choice: string | null, f: FileChange) => {
    if (choice === 'open') edit(f.path)
    if (choice === 'copyPath') window.api.clipboardWrite(inRepo(f.path))
    if (choice === 'sendClaude') sendToClaude(containerApi, inRepo(f.path))
  }
  const fileAction = async (_e: React.MouseEvent, f: FileChange, staged: boolean) => {
    const choice = await popup(changeMenu({ staged, untracked: f.status === '?', sendClaude: !!claudeTarget(containerApi) }))
    if (choice === 'stage') run('stage', { op: 'stage', paths: [f.path] })
    if (choice === 'unstage') run('unstage', { op: 'unstage', paths: f.oldPath ? [f.oldPath, f.path] : [f.path] })
    if (choice === 'discard' && confirm(f.status === '?' ? t('Eliminare {path}? Il file non è tracciato da git: non si potrà recuperare.', { path: f.path }) : t('Scartare le modifiche a {path}? Non si potranno recuperare.', { path: f.path })))
      run('discard', { op: 'discard', paths: [f.path], untracked: f.status === '?' })
    refAction(choice, f)
  }
  const commitFileAction = async (_e: React.MouseEvent, f: FileChange) => refAction(await popup(fileRefMenu({ sendClaude: !!claudeTarget(containerApi) })), f)

  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => void logRef.current?.querySelector('.git-row.sel')?.scrollIntoView({ block: 'nearest' }), [selected])
  const select = (sha: string | null) => {
    setSelected(sha)
    setDiff(null)
  }
  const matches = useMemo(() => (search ? log.filter(c => matchCommit(c, search)) : []), [log, search])
  const findNext = (dir: 1 | -1) => {
    const i = nextMatch(log, search ?? '', log.findIndex(c => c.sha === selected), dir)
    if (i >= 0) select(log[i].sha)
  }
  const closeSearch = () => (setSearch(null), logRef.current?.focus())
  const keys = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return // typing in the search box
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault()
      setSearch(q => q ?? '')
      return void setTimeout(() => searchRef.current?.select())
    }
    const at = log.findIndex(c => c.sha === selected)
    const i = listKey(e.key, at, log.length)
    if (i !== null) select(log[i].sha)
    else if ((e.key === 'Enter' || e.key === 'ContextMenu') && log[at]) commitAction(log[at])
    else if (e.key === 'Escape' && diff) setDiff(null)
    else if (e.key === 'Escape' && highlight) setHighlight(null)
    else return
    e.preventDefault()
  }

  // no rootRef here: the observer would stay on a replaced div and stop the polling that notices a `git init`
  if (!status) return <div className="git-empty">{t('Caricamento…')}</div>
  if (!status.repo)
    return (
      <div className="git-empty">
        {noGit ? t('Serve git: su macOS installa gli strumenti da riga di comando (xcode-select --install), su Linux il pacchetto git.') : (status.message || t('Non è un repository git'))}
        <div className="git-empty-path">{cwd}</div>
        {noGit && <button onClick={refresh}>{t('Riprova')}</button>}
      </div>
    )

  const op = status.operation
  const opName = op === 'merge' ? 'Merge' : op === 'rebase' ? 'Rebase' : op === 'cherry-pick' ? 'Cherry-pick' : 'Revert'
  return (
    <div ref={rootRef} className={'git-tile' + (sidebar ? '' : ' no-sidebar')}>
      <div className="git-toolbar">
        <button className={sidebar ? 'on' : ''} title={sidebar ? t('Nascondi i rami') : t('Mostra i rami')} onClick={() => setSidebar(v => !v)}>
          <PanelLeft {...ICON} />
        </button>
        <span className="git-branch">
          <GitBranch {...ICON} /> {status.branch ?? t('(HEAD staccato)')}
        </span>
        {status.upstream && (
          <span className="git-sync" title={status.upstream}>
            <ArrowDown size={12} />
            {status.behind} <ArrowUp size={12} />
            {status.ahead}
          </span>
        )}
        <div className="spacer" />
        {(['fetch', 'pull', 'push'] as const).map(o => (
          <button key={o} title={o === 'fetch' ? 'Fetch' : o === 'pull' ? 'Pull' : 'Push'} disabled={!!busy} onClick={() => run(o, o === 'push' ? { op: o, setUpstream: !status.upstream, remote: status.remote ?? 'origin' } : { op: o })}>
            {busy === o ? '…' : o === 'fetch' ? <><RefreshCw {...ICON} /><span className="label">Fetch</span></> : o === 'pull' ? <><ArrowDownToLine {...ICON} /><span className="label">Pull</span></> : <><ArrowUpFromLine {...ICON} /><span className="label">Push</span></>}
          </button>
        ))}
        <button title={t('Stash: metti da parte le modifiche')} disabled={!!busy || !dirty} onClick={() => setDialog({ kind: 'stash' })}>
          <Archive {...ICON} />
          <span className="label">Stash</span>
        </button>
        <button title={t("Pop: riapplica l'ultimo stash")} disabled={!!busy || !refs.stashes.length} onClick={() => run('stash', { op: 'stashPop', index: 0 })}>
          <ArchiveRestore {...ICON} />
          <span className="label">Pop</span>
        </button>
        <button disabled={!!busy} title={t('Aggiorna')} onClick={refresh}>
          <RotateCw {...ICON} />
        </button>
      </div>
      {op && (
        <div className="git-merge">
          <b>
            {status.conflicts.length ? t('{op} in corso: {n} file in conflitto', { op: opName, n: status.conflicts.length }) : t('{op} in corso', { op: opName })}
          </b>
          {status.conflicts.length > 0 && <div className="hint">{t("Risolvi i conflitti (doppio clic sul file per l'editor), mettili in stage, poi Continua.")}</div>}
          <ul>
            {status.conflicts.map(f => (
              <li key={f} onDoubleClick={() => edit(f)}>
                {f}
              </li>
            ))}
          </ul>
          <button disabled={!!busy || status.conflicts.length > 0} onClick={() => run('continue', { op: 'continue', what: op })}>
            {t('Continua')}
          </button>
          <button disabled={!!busy} onClick={() => run('abort', { op: 'abort', what: op })}>
            {t('Annulla {op}', { op: opName })}
          </button>
          <button onClick={() => openTerminal(containerApi, { cwd, host: null }, api.id)}>{t('Apri shell qui')}</button>
        </div>
      )}
      <div className="git-body">
        <GitSidebar refs={refs} current={current} collapsed={collapsed} onToggle={toggle} hidden={hidden} onToggleHidden={toggleHidden} selected={selected} onPick={sha => (select(sha), setHighlight(sha))} onOpen={checkout} onMenu={sideAction} onDrop={onDrop} claude={claudeOn} onOpenWorktree={w => (claudeOn ? openClaude(containerApi, { cwd: w.path }, api.id) : openFolder(containerApi, { path: w.path, host: null }, api.id))} />
        <div className="git-center">
          {diff ? (
            <DiffView key={JSON.stringify(diff)} cwd={cwd} spec={diff} tick={tick} onClose={() => setDiff(null)} />
          ) : (
            <>
              {(solo || hidden.length > 0) && (
                <div className="git-viewbar">
                  {solo ? (
                    <>
                      {t('Solo:')} <b>{solo.replace(/^refs\/(heads|remotes|tags)\//, '')}</b>
                    </>
                  ) : hidden.length === 1 ? (
                    t('1 ramo nascosto')
                  ) : (
                    t('{n} rami nascosti', { n: hidden.length })
                  )}
                  <button title={t('Mostra tutti i rami')} onClick={() => (setSolo(null), setHidden([]))}>
                    <X {...ICON} />
                  </button>
                </div>
              )}
              <div ref={logRef} className="git-log" tabIndex={0} data-autofocus onKeyDown={keys}>
                <div className="git-log-head">
                  <span className="refs-col" style={{ width: refsWidth }}>
                    {t('Rami')}
                    <span className="resize" onPointerDown={resizeRefs} />
                  </span>
                  <span className="subject">Commit</span>
                  {search !== null && (
                    <span className="git-search">
                      <Search size={11} />
                      <input
                        ref={searchRef}
                        autoFocus
                        value={search}
                        placeholder={t('Cerca messaggio, autore, sha')}
                        spellCheck={false}
                        onChange={e => setSearch(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') findNext(e.shiftKey ? -1 : 1)
                          else if (e.key === 'Escape') closeSearch()
                          else return
                          e.preventDefault()
                        }}
                      />
                      <span className="count">
                        {matches.findIndex(c => c.sha === selected) + 1}/{matches.length}
                      </span>
                      <X size={11} className="clear" onClick={closeSearch} />
                    </span>
                  )}
                </div>
                {dirty > 0 && (
                  <div className={'git-row wip' + (selected === null ? ' sel' : '')} onClick={() => select(null)}>
                    <span className="refs-col" style={{ width: refsWidth }} />
                    <span className="wip-dot" />
                    <span className="subject">
                      {dirty === 1 ? t('1 file modificato') : t('{n} file modificati', { n: dirty })}
                      {changes.staged.length ? ' · ' + t('{n} in stage', { n: changes.staged.length }) : ''}
                    </span>
                  </div>
                )}
                {log.length === 0 && <div className="git-empty">{t('Nessun commit')}</div>}
                {log.map((c, i) => (
                  <div
                    key={c.sha}
                    className={'git-row' + (selected === c.sha ? ' sel' : '') + (lit && !lit.has(c.sha) ? ' dim' : '') + (search && matchCommit(c, search) ? ' match' : '')}
                    onClick={() => (select(c.sha), setHighlight(null))}
                    onContextMenu={e => (e.preventDefault(), select(c.sha), commitAction(c))}
                    title={c.sha}
                  >
                    <span className="refs-col" style={{ width: refsWidth }}>
                      {(() => {
                        if (!c.refs.length) return null
                        const [r, ...more] = [...c.refs].sort((a, b) => RANK[a.kind] - RANK[b.kind])
                        return (
                          <>
                            <RefBadge
                              r={r}
                              onClick={e => (e.stopPropagation(), select(c.sha), setHighlight(c.sha))}
                              onDoubleClick={() => r.kind !== 'tag' && r.name !== 'HEAD' && checkout(r.name, r.kind === 'remote')}
                              onMenu={r.name === 'HEAD' ? undefined : e => sideAction(e, { name: r.name, kind: r.kind === 'head' ? 'branch' : r.kind })}
                              onDrop={s => onDrop(s, { name: r.name, kind: r.kind === 'remote' ? 'remote' : 'branch' })}
                            />
                            {more.length > 0 && (
                              <span className="ref more" title={[r, ...more].map(x => x.name).join('\n')}>
                                +{more.length}
                              </span>
                            )}
                          </>
                        )
                      })()}
                    </span>
                    <Lanes row={rows[i]} merge={c.parents.length > 1} width={graphWidth} />
                    <span className="subject">{c.subject}</span>
                    <span className="author">{c.author}</span>
                    <span className="date">{ago(c.time)}</span>
                  </div>
                ))}
                {log.length >= limit && (
                  <button className="git-more" onClick={() => setLimit(l => l + 500)}>
                    {t('Carica altri 500')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <div className="git-side">
          {selected ? (
            info ? (
              <CommitDetails info={info} diff={diff} onDiff={setDiff} onCopy={s => window.api.clipboardWrite(s)} onMenu={commitFileAction} />
            ) : (
              <div className="git-empty">{t('Caricamento…')}</div>
            )
          ) : (
            <ChangesPanel changes={changes} busy={!!busy} diff={diff} lastMessage={async () => (log[0] ? ((await window.api.gitCommit(cwd, log[0].sha))?.message ?? '') : '')} onDiff={setDiff} onRun={run} onMenu={fileAction} />
          )}
        </div>
      </div>
      {dialog?.kind === 'tag' && (
        <TagDialog
          commit={dialog.commit}
          remote={status.remote}
          onCancel={() => setDialog(null)}
          onConfirm={(name, message, pushTag) => {
            setDialog(null)
            const remote = status.remote
            run('tag', { op: 'tag', name, sha: dialog.commit.sha, message }, ...(pushTag && remote ? [{ op: 'pushTag' as const, name, remote }] : []))
          }}
        />
      )}
      {dialog?.kind === 'branch' && (
        <NameDialog
          title={t('Nuovo ramo da {commit}', { commit: dialog.label })}
          label={t('Nome')}
          isRef
          check={t('Checkout del nuovo ramo')}
          confirmLabel={t('Crea ramo')}
          onCancel={() => setDialog(null)}
          onConfirm={(name, co) => (setDialog(null), run('branch', { op: 'branch', name, sha: dialog.sha, checkout: co }))}
        />
      )}
      {dialog?.kind === 'rename' && (
        <NameDialog
          title={t('Rinomina {name}', { name: dialog.name })}
          label={t('Nuovo nome')}
          initial={dialog.name}
          isRef
          confirmLabel={t('Rinomina')}
          onCancel={() => setDialog(null)}
          onConfirm={to => (setDialog(null), to !== dialog.name && run('rename', { op: 'renameBranch', from: dialog.name, to }))}
        />
      )}
      {dialog?.kind === 'stash' && (
        <NameDialog
          title={t('Stash delle modifiche')}
          label={t('Messaggio (facoltativo)')}
          optional
          confirmLabel="Stash"
          onCancel={() => setDialog(null)}
          onConfirm={m => (setDialog(null), run('stash', { op: 'stash', message: m || null }))}
        />
      )}
      {output && (
        <div className="git-output">
          <button onClick={() => setOutput(null)}>
            <X {...ICON} />
          </button>
          <pre>{output}</pre>
        </div>
      )}
    </div>
  )
}
