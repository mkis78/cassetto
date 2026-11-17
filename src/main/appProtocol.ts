import { isAbsolute, join, relative } from 'node:path'

// The interface is served as app://cassetto/…, not file://: a page loaded from file:// may read any file on the disk
// (the GrantFileProtocolExtraPrivileges fuse, which can then be turned off). Only files under `root` are served.
export const APP_ORIGIN = 'app://cassetto'

// the file an app:// URL stands for, or null when it is not ours or would leave `root`
export function appFile(root: string, url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'app:' || u.host !== 'cassetto') return null
  let path: string
  try {
    path = decodeURIComponent(u.pathname)
  } catch {
    return null // a broken escape
  }
  if (path.includes('\0')) return null
  const file = join(root, path)
  const rel = relative(root, file)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? file : null // not the folder itself, nothing above it
}
