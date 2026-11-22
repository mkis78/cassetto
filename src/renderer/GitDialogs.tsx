import { useState } from 'react'
import { isValidRefName } from '../shared/refName'
import type { Commit } from '../shared/types'
import { t } from '../shared/i18n'

interface TagProps {
  commit: Commit
  remote: string | null
  onConfirm: (name: string, message: string | null, push: boolean) => void
  onCancel: () => void
}

export function TagDialog({ commit, remote, onConfirm, onCancel }: TagProps) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [push, setPush] = useState(!!remote)
  const valid = isValidRefName(name)
  const confirm = () => valid && onConfirm(name, message.trim() || null, push)
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" onKeyDown={e => e.key === 'Escape' && onCancel()}>
        <h3>{t('Crea tag')}</h3>
        <div className="path">
          {commit.sha.slice(0, 8)} · {commit.subject}
        </div>
        <label>{t('Nome')}</label>
        <input autoFocus value={name} placeholder="v1.2.0" onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && confirm()} />
        {name && !valid && <div className="error">{t('Nome non valido')}</div>}
        <label>{t('Messaggio (facoltativo: crea un tag annotato)')}</label>
        <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)} />
        {remote && (
          <label className="check">
            <input type="checkbox" checked={push} onChange={e => setPush(e.target.checked)} /> {t('Push del tag su {remote}', { remote })}
          </label>
        )}
        <div className="actions">
          <button onClick={onCancel}>{t('Annulla')}</button>
          <button className="primary" disabled={!valid} onClick={confirm}>
            {t('Crea tag')}
          </button>
        </div>
      </div>
    </div>
  )
}
