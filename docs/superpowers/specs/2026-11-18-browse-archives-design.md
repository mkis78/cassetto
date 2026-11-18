# Browse archives as folders

Date: 2026-11-18 · Status: draft for approval

## Intent

Opening a `.tar`/`.zip` today hands it to the system (Archive Utility → Finder), which drops the user out of Cassetto. "Estrai qui" (already shipped on this branch) covers "unpack it all". This feature covers the other everyday need: **look inside an archive and take out what you need without leaving Cassetto**.

What the user does inside an archive (user's words, 2026-11-18): see what it contains, open or preview a file on the fly, pull one file or folder out. Not: change the archive's contents.

## Goals

- Double-click an archive → the Files tab shows its contents like a folder (subfolders, list/icons/columns/gallery views, preview, thumbnails, search, Open With).
- Take things out: drag to another panel or the sidebar, or copy (Cmd+C) and paste elsewhere. Always a copy, never a move.
- Leave the archive the way you leave any folder: up from its top, Home, sidebar, path change.
- Works for local archives and archives on SSH hosts.

## Non-goals

- Editing an archive (rename, delete, new file/folder, paste or drop into, saving an edited file back).
- Listing huge archives without extracting them (approach B below); revisit only if extraction time becomes a real complaint.
- Password-protected zips (extraction fails → the error is shown).

## Anti-goals

- Leaving extracted copies around: caches must be removed when no longer shown.
- Any change that could alter the archive file itself.
- OS-specific mounting software (FUSE): rejected, see Approaches.

## Constraints

- macOS and Linux; no native modules; argv-only `execFile` locally, `shQuote` remotely (as Base A).
- Reuse "Estrai qui": same formats (`isArchive`, `archiveStem`), same extract commands (`extractCommand`, the remote script), `unzip -o` with stdin closed.
- UI strings via `t()`, EN in `src/shared/locales/en.ts`.

## Approaches considered

- **A. Extract to a hidden cache folder and browse that (chosen by the user).** Every existing feature (preview, thumbnails, search, Open With, drag out) works unchanged because the files are real. Cost: the whole archive is extracted before it is shown; a big archive needs a visible "opening…" state with Cancel.
- B. List the archive's index (`tar -tv`, `unzip -Z`) and extract members on demand. Instant for huge archives, but every feature would need an archive-aware code path (a virtual filesystem), and each gallery thumbnail is an extraction. Rejected for now; can be added later for very large archives only.
- C. Mount with FUSE. Needs third-party software on macOS; against the cross-platform rule. Rejected.

## Design

### Opening
- Double-click, Enter and the "Apri" menu/action-bar entry on an archive (list, columns, gallery, search results; local and SSH) open it as a folder **in the same tab** *(my call: "Apri" handing an archive to Archive Utility is the problem this feature solves)*. "Apri con…" keeps listing system apps; multi-selection "Apri" keeps today's behaviour. A sidebar item never is an archive. (This replaces today's "double-click extracts"; "Estrai qui" stays in the right-click menu and action bar. The extract-from-search minors parked on this branch go away with it.)
- Main extracts into a cache folder, then the tab lists it:
  - Local: `<userData>/archives/<key>/`, `key` = hash of path + size + mtime, so reopening an unchanged archive reuses the cache instantly; a changed archive gets a new one.
  - SSH: `mktemp -d /tmp/cassetto-archive-XXXXXX` on the host, extraction runs there (same remote extract script).
- **Untrusted archives** *(my call)*: bsdtar and GNU tar already refuse `..` member names and strip leading `/`, and `unzip` refuses `..`; keep those defaults. After extraction, main removes every symlink in the cache whose target resolves outside the cache root (absolute or `..`), and the tab shows "N collegamenti esterni non mostrati". So browsing, preview, drag-out and "up from root" can never leave the cache.
- While extracting, the tab shows "Apro «name»…" with a spinner and **Annulla**, which kills the extraction and removes its cache (on SSH: kill the local ssh, then a follow-up `rm -rf -- <tmpdir>` call; leftovers if that fails are tolerated like a crash's). Failure (corrupt, password, missing tool) shows the error and the tab stays where it was.

### Inside
- The tab's location becomes `{ host, path: <cache path>, archives: [{ archive: <archive path>, root: <cache root> }] }` (persisted in the tab's params). A nested archive opened inside pushes a second entry (stack).
- The path bar shows the archive, not the cache: `/Users/me/Download/foto.zip › 2024/mare` (`›` marks the archive boundary).
- **Read-only**: right-click menus offer only Apri, Apri con, Copia, Copia percorso (the archive path + inner path, e.g. `foto.zip › 2024/a.jpg`), Apri terminale qui; preview (space) works as usual. No rename, duplicate, cut, delete, new file/folder, paste, tags, Estrai qui (a nested archive is browsed by double-click; to unpack it, drag it out first); drops into the tab are refused; Cmd+Z does nothing there.
- Dragging out always copies (the drop target treats an archive source as `copy` even without Option); Cut is disabled so a paste can't move.
- Apri / Apri con / preview use the cached files directly ("Apri" hands the file to its system app, as for any local file; on an SSH host, where Apri means Cassetto's editor, the editor opens it read-only). "Modifica nell'editor" is not offered inside an archive: Cassetto never writes into a cache.

### Leaving
- Up from the archive's root → the folder containing the archive, with the archive selected (for a nested one: back into the outer archive's folder).
- Home, sidebar, Cmd+K, typing a path, or closing the tab leave all archive levels.
- **Who holds a cache** *(my call)*: main keeps a registry `cache → set of holders`. A holder is a Files panel id (one entry per archive level it is inside, so nested levels hold their own caches) or the internal clipboard. A cache is deleted when its set becomes empty. Holders are released when a tab leaves the archive, when its panel is removed, and all at once when the renderer reloads (the restored tabs then acquire again). Two tabs on the same unchanged archive share one cache.
- **Copy, then leave, then paste works** *(my call)*: Cmd+C inside an archive makes the clipboard a holder of that cache, so the files are still there when you paste elsewhere; the clipboard releases it when it changes or on quit. A drag-out completes before any navigation, so it needs no holder.
- All local caches are deleted on quit and any leftovers under `<userData>/archives` at startup. Remote caches are removed when left; leftovers from a crash stay in the host's `/tmp` (`ponytail:` note — the OS clears it).

### Restart
- A tab persisted inside an archive re-opens it on start by extracting again (local and SSH; caches never survive a quit, so the cache key's reuse applies within a session only). If the archive is gone, the tab falls back to its containing folder with a notice.

### Small decisions *(my calls)*
- "Apri terminale qui" inside an archive opens a shell in the cache folder (allowed; it is a copy).
- Tab title and the sidebar's current-folder highlight use the archive's display path; tags and Cmd+Z are off inside an archive.
- An archive that changes on disk while open keeps showing the old cache until it is reopened.

## Left to the builder
- IPC names and the main-side cache registry shape.
- How read-only is expressed in FilesTile (one flag that menus/drops/keys consult).
- Spinner/Cancel look, within the existing styles.
- Tests: cache key, registry ref-counting, path-bar formatting (archive boundary), read-only menu filtering, remote cache script via local `/bin/sh`.
