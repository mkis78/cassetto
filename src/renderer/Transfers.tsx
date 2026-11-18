import { useEffect, useRef, useState } from 'react'
import { ArrowDownUp } from 'lucide-react'
import { isEnded, jobDirs, type JobSnapshot } from '../shared/jobs'
import { formatSize } from '../shared/format'
import { t } from '../shared/i18n'
import { baseName, changed } from './tiles'
import { ICON } from './icons'

const here = () => (window.api.platform === 'darwin' ? t('questo Mac') : t('questo computer'))
const done = (j: JobSnapshot) => (j.total === null ? 0 : Math.min(j.bytes, j.total)) // tar padding can count past the total
const duration = (s: number) => (s < 60 ? t('{n} s', { n: Math.ceil(s) }) : s < 3600 ? t('{n} min', { n: Math.round(s / 60) }) : t('{n} h', { n: Math.round(s / 360) / 10 }))

// the top bar's copies and moves: a ring with the overall progress while jobs exist, a popover with each one
export default function Transfers() {
  const [jobs, setJobs] = useState<JobSnapshot[]>([])
  const seen = useRef(new Set<string>()) // jobs whose end was already handled
  // where each running job was when this window first saw it running, for its speed
  // ponytail: average speed since then, not a sliding window; a stall shows late
  const firstSeen = useRef(new Map<string, { at: number; bytes: number }>())
  useEffect(() => {
    const show = (list: JobSnapshot[]) => {
      setJobs(list)
      for (const j of list.filter(isEnded)) {
        if (seen.current.has(j.id)) continue
        seen.current.add(j.id)
        changed('jobs', jobDirs(j.spec))
        void window.api.archiveRelease(`job:${j.id}`) // a copy out of an archive held its cache
      }
    }
    void window.api.jobList().then(show)
    return window.api.onJobs(show)
  }, [])
  if (!jobs.length) return null

  const active = jobs.filter(j => !isEnded(j))
  const total = active.reduce((n, j) => n + (j.total ?? 0), 0)
  const pct = total ? (active.reduce((n, j) => n + done(j), 0) / total) * 100 : 0
  const now = Date.now()

  const status = (j: JobSnapshot) => {
    if (j.state === 'queued') return t('In coda')
    if (j.state === 'measuring') return t('Calcolo…')
    if (j.state === 'cancelled') return t('Annullato')
    if (j.state === 'failed') return t('{n} non riusciti', { n: j.failed.length })
    if (j.state === 'done') return t('Completato')
    const size = j.total === null ? formatSize(j.bytes) : t('{done} di {total}', { done: formatSize(done(j)), total: formatSize(j.total) })
    const f = firstSeen.current.get(j.id) ?? (firstSeen.current.set(j.id, { at: now, bytes: j.bytes }), { at: now, bytes: j.bytes })
    const secs = (now - f.at) / 1000
    const speed = secs >= 1 ? (j.bytes - f.bytes) / secs : 0
    if (!speed) return size
    return [size, `${formatSize(speed)}/s`, ...(j.total === null ? [] : [duration(Math.max(0, j.total - j.bytes) / speed)])].join(' · ')
  }

  return (
    <>
      <button className="topbar-btn transfers-btn" title={t('Trasferimenti')} popoverTarget="transfers">
        <span className="ring" style={{ '--p': active.length ? pct : 100 } as React.CSSProperties}>
          <span><ArrowDownUp {...ICON} size={11} /></span>
        </span>
      </button>
      <div id="transfers" className="transfers" popover="auto">
        {jobs.map(j => (
          <div key={j.id} className={'job ' + j.state}>
            <div className="job-name">
              <b>{baseName(j.spec.items[0].src)}</b>
              {j.spec.items.length > 1 && <span> +{j.spec.items.length - 1}</span>}
            </div>
            <div className="job-route">{j.spec.from ?? here()} → {j.spec.to ?? here()}</div>
            <div className="job-bar"><i style={{ width: `${j.state === 'done' ? 100 : j.total ? (done(j) / j.total) * 100 : 0}%` }} /></div>
            <div className="job-foot">
              {j.failed.length ? (
                <details>
                  <summary>{status(j)}</summary>
                  <ul>{j.failed.map(f => <li key={f.path}>{baseName(f.path)}: {f.error}</li>)}</ul>
                </details>
              ) : (
                <span>{status(j)}</span>
              )}
              {!isEnded(j) && <button onClick={() => void window.api.jobCancel(j.id)}>{t('Annulla')}</button>}
            </div>
          </div>
        ))}
        {active.length < jobs.length && (
          <div className="transfers-foot">
            <button onClick={() => void window.api.jobClear()}>{t('Pulisci')}</button>
          </div>
        )}
      </div>
    </>
  )
}
