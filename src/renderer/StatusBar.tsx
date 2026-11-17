import { useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'
import type { DirEntry, Listing } from '../shared/types'
import { formatSize } from '../shared/format'
import { diskSummary, folderSummary, kindOf, selectionSummary, type Disk } from '../shared/status'
import { ICON } from './icons'
import { TagChip } from './Tags'
import { locale, t } from '../shared/i18n'

// folders already weighed, by host and path, for this session
// ponytail: never refreshed by itself; "Ricalcola" when the folder changed
const sizes = new Map<string, number | null>()

const when = (ms: number) => new Date(ms).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' })

// at the foot of a files tile: the folder (or the selection) on the left, the disk on the right
export default function StatusBar({ host, col, shown, hidden, picked }: { host: string | null; col: Listing | null; shown: DirEntry[]; hidden: number; picked: { path: string; entry: DirEntry }[] }) {
  const [disk, setDisk] = useState<Disk | null>(null)
  const [, redraw] = useState(0)
  const [weighing, setWeighing] = useState<string | null>(null)
  const dir = col?.path ?? null
  // again on each new listing: an operation in the folder may have used or freed space
  useEffect(() => {
    if (!dir) return
    let live = true
    window.api.disk(host, dir).then(d => live && setDisk(d))
    return () => void (live = false)
  }, [host, dir, col])

  const weigh = async (path: string) => {
    setWeighing(path)
    sizes.set(`${host}:${path}`, await window.api.folderSize(host, path))
    setWeighing(w => (w === path ? null : w))
    redraw(n => n + 1)
  }

  const one = picked.length === 1 ? picked[0] : null
  let left: React.ReactNode
  if (!one) left = picked.length > 1 ? selectionSummary(picked.map(p => p.entry)) : col ? folderSummary(shown, hidden) : ''
  else {
    const { entry: e, path } = one
    const key = `${host}:${path}`
    const known = sizes.get(key)
    left = (
      <>
        <b>{e.name}</b>
        <span>{kindOf(e.name, e.dir)}</span>
        {!e.dir && e.size !== undefined && <span>{formatSize(e.size)}</span>}
        {e.dir &&
          (weighing === path ? (
            <span className="status-busy">
              <span className="spinner" /> {t('calcolo…')}
            </span>
          ) : sizes.has(key) ? (
            <span>
              {known === null ? t('dimensione non disponibile') : t('{size} con il contenuto', { size: formatSize(known!) })}{' '}
              <button className="status-link" onClick={() => weigh(path)}>{t('Ricalcola')}</button>
            </span>
          ) : (
            <button className="status-link" onClick={() => weigh(path)}>{t('Calcola dimensione')}</button>
          ))}
        {e.mtime !== undefined && <span>{t('modificato {when}', { when: when(e.mtime) })}</span>}
        {!!e.tags?.length && (
          <span className="status-tags">
            {e.tags.map(x => (
              <TagChip key={x.name} tag={x} />
            ))}
          </span>
        )}
      </>
    )
  }

  const used = disk ? 1 - disk.free / disk.total : 0
  return (
    <div className="status-bar">
      <div className="status-left">{left}</div>
      {disk && (
        <div className={'status-disk' + (used > 0.9 ? ' full' : '')} title={t('Occupato il {pct}%', { pct: Math.round(used * 100) })}>
          <HardDrive {...ICON} />
          <span className="status-meter">
            <span style={{ width: `${Math.round(used * 100)}%` }} />
          </span>
          {diskSummary(disk)}
        </div>
      )}
    </div>
  )
}
