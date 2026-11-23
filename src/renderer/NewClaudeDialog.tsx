import { useEffect, useState } from 'react'
import type { Account } from '../shared/types'
import { isValidRefName } from '../shared/refName'
import { t } from '../shared/i18n'

export type ClaudeWhere = { cwd: string; account?: string; name?: string }

// a new Claude Code tab: the folder, the cswap account (when there are accounts), the tab's name, optionally a fresh worktree
export default function NewClaudeDialog({ initialCwd, onConfirm, onCancel }: { initialCwd?: string; onConfirm: (w: ClaudeWhere) => void; onCancel: () => void }) {
  const [cwd, setCwd] = useState<string | null>(initialCwd ?? null)
  const [account, setAccount] = useState('')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  // a second Claude on the same repository works best on its own branch and folder: a git worktree
  const [isRepo, setIsRepo] = useState(false)
  const [worktree, setWorktree] = useState(false)
  const [branch, setBranch] = useState(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `claude/${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
  })
  const [creating, setCreating] = useState(false)
  const [wtError, setWtError] = useState<string | null>(null)

  // a cswap that fails to list is worth saying; no cswap at all is not
  // fresh tools first: a cswap installed since the first Claude is found, and its accounts listed with that PATH
  useEffect(() => void window.api.claudeTools(true).then(tools => window.api.claudeAccounts().then(r => (setAccounts(r.accounts), setError(tools.cswap ? r.error : null)))), [])
  useEffect(() => {
    setIsRepo(false)
    if (cwd) void window.api.gitStatus(cwd).then(s => setIsRepo(s.repo))
  }, [cwd])

  const wt = worktree && isRepo
  const open = async () => {
    if (!cwd || creating || (wt && !isValidRefName(branch.trim()))) return
    const w = { account: account || undefined, name: name.trim() || undefined }
    if (!wt) return onConfirm({ cwd, ...w })
    setCreating(true)
    const r = await window.api.gitWorktreeAdd(cwd, branch.trim())
    setCreating(false)
    if (!r.ok) return setWtError(r.error)
    onConfirm({ cwd: r.path, ...w })
  }

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" onKeyDown={e => e.key === 'Escape' && onCancel()}>
        <h3>{t('Nuovo Claude Code')}</h3>
        <label>{t('Cartella')}</label>
        <div className="row">
          <span className="path">{cwd ?? t('nessuna cartella scelta')}</span>
          <button onClick={() => window.api.pickFolder(cwd ?? undefined).then(p => p && (setCwd(p), setWtError(null)))}>{t('Scegli cartella…')}</button>
        </div>
        {accounts.length > 0 && (
          <>
            <label>{t('Account')}</label>
            <select value={account} onChange={e => setAccount(e.target.value)}>
              <option value="">{t('Account della cartella (cswap map)')}</option>
              {accounts.map(a => (
                <option key={a.slot} value={String(a.slot)}>
                  {a.slot} · {a.email} — 5h {a.usage5h ?? '–'}% · 7d {a.usage7d ?? '–'}%
                </option>
              ))}
            </select>
          </>
        )}
        {error && <div className="error">{error}</div>}
        <label>{t('Nome')}</label>
        <input autoFocus value={name} placeholder={cwd ? cwd.split('/').filter(Boolean).pop() : ''} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && open()} />
        {isRepo && (
          <>
            <label className="check">
              <input type="checkbox" checked={worktree} onChange={e => setWorktree(e.target.checked)} /> {t('Nuovo worktree')}
            </label>
            {worktree && (
              <>
                <label>{t('Ramo')}</label>
                <input value={branch} spellCheck={false} onChange={e => (setBranch(e.target.value), setWtError(null))} onKeyDown={e => e.key === 'Enter' && open()} />
                <div className="hint">{t('Un nuovo ramo in una cartella a parte: altri Claude sullo stesso repository non toccano i suoi file.')}</div>
              </>
            )}
            {wtError && <div className="error">{wtError}</div>}
          </>
        )}
        <div className="actions">
          <button onClick={onCancel}>{t('Annulla')}</button>
          <button className="primary" disabled={!cwd || creating || (wt && !isValidRefName(branch.trim()))} onClick={open}>
            {creating ? t('Creo il worktree…') : t('Apri')}
          </button>
        </div>
      </div>
    </div>
  )
}
