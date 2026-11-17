import type { Favourite } from './types'

// at the end, unless that folder (same host and path) is already there
export const addFavourite = (list: Favourite[], f: Favourite): Favourite[] => (list.some(x => x.host === f.host && x.path === f.path) ? list : [...list, f])

// the servers the sidebar lists: the last ones opened, newest first
export const RECENT_HOSTS = 5
export const pushRecent = (list: string[] | undefined, host: string): string[] => [host, ...(list ?? []).filter(h => h !== host)].slice(0, RECENT_HOSTS)

// the one at `from` taken out and put back at `to`
export function moveFavourite(list: Favourite[], from: number, to: number): Favourite[] {
  const out = list.filter((_, i) => i !== from)
  out.splice(to, 0, list[from])
  return out
}
