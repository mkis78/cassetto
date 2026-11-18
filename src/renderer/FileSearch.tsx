import { useEffect, useRef, useState } from 'react'
import type { SearchHit, SearchQuery, SearchResult } from '../shared/types'
import { Ellipsis, File } from 'lucide-react'
import { ICON } from './icons'
import { TagDots } from './Tags'
import { highlight } from '../shared/highlight'
import { searchMenu } from '../shared/menus'
import { listKey } from '../shared/listNav'
import { popup } from './menuIcons'
import { t } from '../shared/i18n'

type Props = {
  tileId: string
  host: string | null // null = this machine
  cwd: string
  q: SearchQuery
  onSelect: (full: string) => void
  onFolder: (dir: string) => void // "Apri cartella": the files tile goes there
  onOpen: (full: string, double?: boolean) => void
}

export const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/')) || '/'

// recursive search below `cwd`, here or on an ssh host: results of the files tile while its search box has text
export default function FileSearch({ tileId, host, cwd, q, onSelect, onFolder, onOpen }: Props) {
  // a result with the query and the run it answers; it grows while hits stream in
  const [answer, setAnswer] = useState<{ n: number; q: SearchQuery; r: SearchResult } | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const [cur, setCur] = useState(-1) // keyboard cursor over the rows below, file rows included
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => void setCur(-1), [answer?.n]) // a new search, not each batch of the same one
  useEffect(() => void listRef.current?.querySelector('.file.selected')?.scrollIntoView({ block: 'nearest' }), [cur])

  // search while typing, 200 ms after the last key; main cancels the previous search of this tile.
  // Hits show as they are found: the old results stay until the first ones of the new search arrive.
  useEffect(() => {
    const n = ++seq.current
    if (!q.text) return void (setAnswer(null), setBusy(false))
    let off = () => {}
    const timer = setTimeout(async () => {
      setBusy(true)
      off = window.api.onSearchHits(tileId, n, hits =>
        setAnswer(a => (a?.n === n ? { ...a, r: { ...a.r, hits: [...a.r.hits, ...hits] } } : { n, q, r: { hits, truncated: false, error: null } }))
      )
      const r = await window.api.search(tileId, n, host, cwd, q)
      off()
      if (n !== seq.current) return // a newer search is on its way
      setBusy(false)
      setAnswer({ n, q, r }) // the whole result, the hits not streamed yet included
    }, 200)
    return () => (clearTimeout(timer), off())
  }, [q, cwd, host])


  const fullOf = (hit: SearchHit) => `${cwd.replace(/\/$/, '')}/${hit.path}`
  const act = (choice: string, hit: SearchHit, double = false) => {
    const full = fullOf(hit)
    const at = hit.line ? `${full}:${hit.line}` : full
    if (choice === 'open') return onOpen(full, double)
    if (choice === 'copyPath') return void window.api.clipboardWrite(host ? `${host}:${at}` : at)
    if (choice === 'folder') return onFolder(dirOf(full))
  }
  const menu = async (e: React.SyntheticEvent, hit: SearchHit) => {
    e.preventDefault()
    e.stopPropagation()
    const choice = await popup(searchMenu({ line: !!hit.line }))
    if (choice) act(choice, hit)
  }
  const more = (hit: SearchHit) => (
    <button className="search-more" title={t('Azioni')} onClick={e => menu(e, hit)}>
      <Ellipsis {...ICON} />
    </button>
  )
  const pick = (i: number) => {
    setCur(i)
    onSelect(fullOf(rows[i]))
  }
  let n = 0 // rows are numbered as they render, in the same order as `rows`
  const row = (hit: SearchHit, cls: string) => {
    const i = n++
    return {
      className: `file ${cls}` + (i === cur ? ' selected' : ''),
      onClick: () => pick(i),
      onDoubleClick: () => act('open', hit, true),
      onContextMenu: (e: React.MouseEvent) => menu(e, hit)
    }
  }

  // results of an older query stay on screen while the new one runs, but never across modes:
  // a content hit shown as a file name (or the reverse) would be wrong, not just stale
  const result = answer && answer.q.mode === q.mode ? answer.r : null
  const shown = answer?.q ?? q // highlight with the query that produced these lines

  // content hits grouped by file, in the order the search found them
  const groups = new Map<string, SearchHit[]>()
  if (q.mode === 'content') for (const h of result?.hits ?? []) groups.set(h.path, [...(groups.get(h.path) ?? []), h])
  const rows: SearchHit[] = q.mode === 'content' ? [...groups].flatMap(([path, hits]) => [{ path }, ...hits]) : (result?.hits ?? [])

  const keys = (e: React.KeyboardEvent) => {
    const i = listKey(e.key, cur, rows.length)
    if (i !== null) pick(i)
    else if (e.key === 'Enter' && rows[cur]) act('open', rows[cur])
    else if (e.key === 'ContextMenu' && rows[cur]) menu(e, rows[cur])
    else return
    e.preventDefault()
  }

  const marked = (text: string, query: SearchQuery) =>
    highlight(text, query).map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))
  // a file name lights up only for a plain word: a glob (*.ts) matches it whole
  const nameQuery = /[*?]/.test(shown.text) || shown.mode === 'tag' ? null : { ...shown, regex: false, word: false }
  // name and folder of a hit, the name first: what is looked for stands out, the folder says where
  const nameDir = (path: string) => {
    const cut = path.lastIndexOf('/')
    const name = path.slice(cut + 1)
    return (
      <span className="search-name">
        <b>{nameQuery ? marked(name, nameQuery) : name}</b>
        {cut > 0 && <span className="search-dir">{path.slice(0, cut)}</span>}
      </span>
    )
  }
  const files = q.mode === 'content' ? groups.size : (result?.hits.length ?? 0)
  const dirName = cwd.split('/').filter(Boolean).pop() ?? '/'
  const where = q.subfolders === false ? t('{dir} (senza sottocartelle)', { dir: dirName }) : t('{dir} e sottocartelle', { dir: dirName })
  const streaming = busy && answer?.n === seq.current // hits of the search still running are on screen
  const summary = busy
    ? streaming
      ? t('Cerco… {n} trovati finora · {where}', { n: result?.hits.length ?? 0, where })
      : t('Cerco in {where}…', { where })
    : result && !result.error
      ? q.mode === 'content'
        ? result.hits.length === 1
          ? t('1 risultato in {files} file · {where}', { files, where })
          : t('{n} risultati in {files} file · {where}', { n: result.hits.length, files, where })
        : files === 1
          ? t('1 file · {where}', { where })
          : t('{files} file|plurale · {where}', { files, where })
      : null

  return (
    <div ref={listRef} tabIndex={0} data-autofocus className="files-list search-results" onKeyDown={keys}>
      {summary && (
        <div className="search-summary">
          {busy && <span className="spinner" />}
          {summary}
          {result?.truncated && !busy && <span className="search-truncated"> · {t('solo i primi: restringi la ricerca')}</span>}
        </div>
      )}
      {result?.error && (
        <div className="files-error">
          <pre>{result.error}</pre>
        </div>
      )}
      {q.mode === 'content'
        ? [...groups].map(([path, hits]) => (
            <div key={path} className="search-group">
              <div {...row({ path }, 'search-file')} title={path}>
                <File {...ICON} />
                {nameDir(path)}
                <span className="search-count">{hits.length}</span>
              </div>
              {hits.map(h => (
                <div key={h.line} {...row(h, 'search-hit')}>
                  <span className="search-line">{h.line}</span>
                  <span className="search-text">{marked((h.text ?? '').trimStart(), shown)}</span>
                  {more(h)}
                </div>
              ))}
            </div>
          ))
        : result?.hits.map(h => (
            <div key={h.path} {...row(h, 'search-name-hit')} title={h.tags ? `${h.path}\n${h.tags.map(x => x.name).join(', ')}` : h.path}>
              <File {...ICON} />
              {nameDir(h.path)}
              <TagDots tags={h.tags} />
              {more(h)}
            </div>
          ))}
      {result && !result.error && !result.hits.length && !busy && <div className="files-empty">{t('Nessun risultato per «{text}»', { text: shown.text })}</div>}
    </div>
  )
}
