import { useEffect, useState } from 'react'
import { listKey } from '../shared/listNav'
import { t } from '../shared/i18n'

interface Props {
  onPick: (host: string) => void
  onCancel: () => void
}

export default function SshDialog({ onPick, onCancel }: Props) {
  const [hosts, setHosts] = useState<string[] | null>(null)
  const [filter, setFilter] = useState('')
  const [cur, setCur] = useState(0)
  useEffect(() => {
    window.api.sshHosts().then(setHosts)
  }, [])
  const shown = (hosts ?? []).filter(h => h.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" onKeyDown={e => e.key === 'Escape' && onCancel()}>
        <h3>{t('Connetti a server SSH')}</h3>
        <input
          autoFocus
          placeholder={t('Filtra host… (Invio: apri)')}
          value={filter}
          onChange={e => (setFilter(e.target.value), setCur(0))}
          onKeyDown={e => {
            const i = listKey(e.key, cur, shown.length)
            if (i !== null) return void (e.preventDefault(), setCur(i))
            if (e.key === 'Enter' && shown[cur]) onPick(shown[cur])
          }}
        />
        <div className="host-list">
          {hosts === null && <div className="path">{t('Caricamento…')}</div>}
          {hosts?.length === 0 && <div className="path">{t('Nessun host in ~/.ssh/config')}</div>}
          {shown.map((h, i) => (
            <div key={h} className={'host' + (i === cur ? ' active' : '')} ref={el => void (i === cur && el?.scrollIntoView({ block: 'nearest' }))}>
              <span>{h}</span>
              <button onClick={() => onPick(h)}>{t('Apri')}</button>
            </div>
          ))}
        </div>
        <div className="actions">
          <button onClick={onCancel}>{t('Chiudi')}</button>
        </div>
      </div>
    </div>
  )
}
