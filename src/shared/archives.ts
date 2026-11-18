// one level of "inside an archive": the archive file (on its host) and the cache folder it was extracted to
export type ArchiveLevel = { archive: string; root: string }
