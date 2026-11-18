// one level of "inside an archive": the archive file (on its host) and the cache folder it was extracted to
export type ArchiveLevel = { archive: string; root: string }

const dirname = (p: string): string => p.replace(/\/[^/]*$/, '') || '/'
const within = (p: string, root: string): boolean => p === root || p.startsWith(root.endsWith('/') ? root : root + '/')

// the path as the user sees it: each cache root (innermost first) shown as "<archive> › "
export function displayPath(path: string, levels: ArchiveLevel[]): string {
  let out = path
  for (let i = levels.length - 1; i >= 0; i--) {
    const { archive, root } = levels[i]
    if (within(out, root)) out = `${archive} › ${out.slice(root.length).replace(/^\//, '')}`.trimEnd()
  }
  return out
}

// the folder above; leaving an archive's root lands next to the archive with it selected
export function parentOf(path: string, levels: ArchiveLevel[]): { path: string; levels: ArchiveLevel[]; select?: string } {
  const level = levels[levels.length - 1]
  if (level && path === level.root) return { path: dirname(level.archive), levels: levels.slice(0, -1), select: level.archive }
  return { path: dirname(path), levels }
}

export const insideArchive = (path: string, levels: ArchiveLevel[]): boolean => levels.length > 0 && within(path, levels[levels.length - 1].root)
