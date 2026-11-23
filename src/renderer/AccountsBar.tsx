import { useEffect, useState } from 'react'
import { t } from '../shared/i18n'
import type { Account } from '../shared/types'

const level = (n: number) => (n > 80 ? 'high' : n >= 50 ? 'mid' : '')

// cswap usage per account, only for who has cswap; on error keeps the last good value
export default function AccountsBar() {
  const [accounts, setAccounts] = useState<Account[]>([])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    let alive = true
    let busy = false
    const poll = async () => {
      if (busy) return // chained: never more than one call in flight
      busy = true
      clearTimeout(timer)
      try {
        const r = await window.api.claudeAccounts()
        if (alive && !r.error) setAccounts(r.accounts)
      } catch {
        // keep the last good value
      } finally {
        busy = false
        if (alive) timer = setTimeout(poll, 60_000)
      }
    }
    // without cswap on PATH there is nothing to poll; coming back to the window looks again (a cswap installed meanwhile)
    let polling = false
    const look = () =>
      void window.api.claudeTools().then(tools => {
        if (!alive || polling || !tools.cswap) return
        polling = true
        window.removeEventListener('focus', look)
        poll()
        window.addEventListener('focus', poll)
      }, () => {})
    look()
    window.addEventListener('focus', look)
    return () => {
      alive = false
      clearTimeout(timer)
      window.removeEventListener('focus', look)
      window.removeEventListener('focus', poll)
    }
  }, [])

  if (!accounts.length) return null
  return (
    <div className="accounts">
      {accounts.map(a => (
        <span
          key={a.slot}
          className={'acc ' + level(Math.max(a.usage5h ?? 0, a.usage7d ?? 0))}
          title={`${a.email}${a.active ? ` (${t('attivo')})` : ''}\n5h ${a.usage5h ?? '–'}% · 7d ${a.usage7d ?? '–'}%`}
        >
          {a.label || a.email.split('@')[0]} <b>{a.usage5h ?? '–'}%</b> · <b>{a.usage7d ?? '–'}%</b>
        </span>
      ))}
    </div>
  )
}
