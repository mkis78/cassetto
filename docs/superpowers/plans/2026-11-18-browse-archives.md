# Browse Archives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opening an archive (double-click, Enter, Apri) shows its contents as a read-only folder in the same Files tab, by extracting it to a cache that lives exactly as long as something shows or holds it.

**Architecture:** Main owns extraction and a cache registry (`src/main/archives.ts`): caches keyed per archive, held by Files panel ids and the internal clipboard, deleted when no holder is left, on quit and at startup. Shared pure helpers (`src/shared/archives.ts`) give the display path and read-only rules. FilesTile keeps a stack of archive levels in its params and consults one `readOnly` flag.

**Tech Stack:** Electron 45, React 19, dockview, vitest; `tar`/`unzip` via the existing `extractCommand` and remote extract script.

**Spec:** `docs/superpowers/specs/2026-11-18-browse-archives-design.md`

## Global Constraints

- macOS and Linux; no native modules; argv-only `execFile` locally, `shQuote` remotely.
- Reuse `isArchive`/`archiveStem` (`src/shared/fileOps.ts`), `extractCommand` (`src/main/fileOps.ts:30`) and the remote extract command shape (`src/main/fileOps.ts:164-169`: `unzip -q -o … || tar -xf …`); stdin of local children closed.
- Cassetto never writes into a cache except extracting into it and deleting it; never modifies the archive file.
- Local caches: `<userData>/archives/<key>/`; deleted when unheld, on quit, and leftovers at startup. Remote caches: `mktemp -d /tmp/cassetto-archive-XXXXXX` on the host, removed when unheld.
- Symlinks in a cache whose target is absolute or resolves outside the cache root are removed after extraction; the tab shows `t('{n} collegamenti esterni non mostrati', { n })`.
- Read-only inside an archive: menus offer only Apri, Apri con, Copia, Copia percorso, Apri terminale qui (+ preview); no rename, duplicate, cut, delete, new, paste, drop-in, tags, Estrai qui, Modifica nell'editor, Cmd+Z.
- UI strings via `t()`, EN in `src/shared/locales/en.ts`. English commit messages, NO Co-Authored-By / Claude trailers.

## Review Focus

- Archive that fails to extract (corrupt, password zip) → error notice, tab stays where it was, no cache left (Task 1 test `openArchive cleans up a failed extraction`).
- Hostile archive with a symlink to `/etc` or `../../x` → link removed, count reported, nothing outside the cache reachable (Task 1 test `openArchive removes symlinks leaving the cache`).
- Two tabs on the same archive, one leaves → cache still there; second leaves → cache gone (Task 1 test `registry deletes a cache only when its last holder releases`).
- Copy inside, leave, paste elsewhere → files still there (Task 1 test `clipboard holder keeps a cache alive`; Task 3 manual check).
- Up from the archive root → containing folder with the archive selected; nested archive → back into the outer archive (Task 2 test `parentOf leaves the archive at its root`).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/main/archives.ts` (new) | cache key, registry (holders), open (extract + symlink prune), cancel, release, sweep |
| `src/main/index.ts` (modify) | IPC `archive:open`, `archive:cancel`, `archive:release`, `archive:releaseAll`; quit + startup cleanup |
| `src/preload/index.ts` (modify) | expose the four calls |
| `src/shared/archives.ts` (new) | `ArchiveLevel` type, `displayPath`, `parentOf`, `readOnlyMenu` filter |
| `src/shared/types.ts` (modify) | `FilesParams.archives?: ArchiveLevel[]`; `EditorParams.readOnly?: boolean` |
| `src/renderer/FilesTile.tsx`, `FileSearch.tsx`, `App.tsx`, `EditorTile.tsx`, `Sidebar.tsx`, `styles.css`, `locales/en.ts` (modify) | archive mode wiring |

---

### Task 1: Archive caches in main

**Files:** Create `src/main/archives.ts`; modify `src/main/index.ts`, `src/preload/index.ts`; test `test/archives.main.test.ts`.

**Interfaces:**
- Produces (`src/shared/archives.ts` type, created here): `export type ArchiveLevel = { archive: string; root: string }` (archive: the archive file's path on its host; root: the cache folder).
- Produces (`src/main/archives.ts`):
  - `cacheKey(host: string | null, path: string, size: number, mtimeMs: number): string` — sha1 hex of `${host ?? ''}\0${path}\0${size}\0${mtimeMs}`.
  - `class ArchiveCaches { constructor(deps: { base: string; remove: (host: string | null, root: string) => Promise<void> }); acquire(host: string | null, root: string, holder: string): void; release(holder: string, root?: string): Promise<void>; releaseAll(): Promise<void>; holders(root: string): number }` — `release` without `root` drops every cache the holder holds; a cache whose holder set becomes empty is removed through `deps.remove`.
  - `openLocal(base: string, archive: string, signal: AbortSignal): Promise<{ root: string; hidden: number }>` — stat archive → key → if `<base>/<key>` exists reuse it; else extract into `<base>/<key>.partial` (mkdir, `extractCommand`, stdin closed, aborted by `signal` → kill), then `pruneLinks`, then rename to `<base>/<key>`. On any failure remove the `.partial` dir and throw the stderr/message.
  - `pruneLinks(root: string): Promise<number>` — walk with `lstat` (never follow links), remove each symlink whose `readlink` target is absolute or whose `resolve(dirname(link), target)` is not inside `root`; return the count.
  - `remoteOpenScript(archive: string): string` — prints the cache dir then `\0` then the removed-link count: `d=$(mktemp -d /tmp/cassetto-archive-XXXXXX) || exit 1`; extract like `fileOps.ts:164-169` into `$d` (on failure `rm -rf -- "$d"; exit 1`); then `n=0; find "$d" -type l | while IFS= read -r l; do case $(readlink "$l") in /*|*..*) rm -f -- "$l"; …` (count via a temp file or `find … -print | wc -l` before removal); `printf '%s\0%s' "$d" "$n"`. All archive paths via `shQuote`.
  - `sweep(base: string): Promise<void>` — `rm -rf` every entry of `base`.
- Produces IPC (index.ts) and preload:
  - `archive:open(host, archive, holder) → { ok: true; root: string; hidden: number } | { ok: false; error: string }` / `archiveOpen(host, archive, holder)`; acquires on success. One in-flight open per holder; a new one aborts the previous.
  - `archive:cancel(holder)` / `archiveCancel(holder)` — aborts the in-flight open (remote: kill the ssh child, then `sshRun(host, 'rm -rf -- <d>')` if a dir was printed — else ignore).
  - `archive:hold(holder, host, root)` / `archiveHold(holder, host, root)` → `caches.acquire(host, root, holder)` (used by the internal clipboard, holder `'clipboard'`).
  - `archive:release(holder, root?)` / `archiveRelease(holder, root?)`; `archive:releaseAll()` / `archiveReleaseAll()`.
  - `base = join(app.getPath('userData'), 'archives')`; `sweep(base)` at startup before the window opens; `releaseAll()` + `sweep(base)` on `before-quit`. Remote `remove` = `sshRun(host, 'rm -rf -- ' + shQuote(root))`, local `remove` = `rm(root, { recursive: true, force: true })`.

- [ ] **Step 1: Failing tests** in `test/archives.main.test.ts` (real files in `mkdtempSync`; build archives with `execFileSync('tar', …)`):
  - `cacheKey` stable for same inputs, differs when size or mtime differ.
  - `registry deletes a cache only when its last holder releases`: acquire(null,'/c','p1'), acquire(null,'/c','p2'); release('p1') → remove not called; release('p2') → remove called once with (null,'/c'). `releaseAll` removes every held cache. `release(holder)` without root drops all of that holder's caches.
  - `clipboard holder keeps a cache alive`: acquire by 'p1' and 'clipboard'; release('p1') → not removed; release('clipboard') → removed. Releasing a holder that holds nothing is a no-op.
  - `openLocal` extracts a `.tar.gz` with `a/b.txt` → `<root>/a/b.txt` content ok; second call with same archive returns the same root without re-extracting (mtime of root unchanged).
  - `openArchive cleans up a failed extraction`: corrupt `x.tar.gz` → rejects; no `<key>` nor `<key>.partial` left in base.
  - `openArchive removes symlinks leaving the cache`: archive containing `in -> a/b.txt`, `abs -> /etc/passwd`, `up -> ../../x` (create with `ln -s` before `tar -cf`) → `hidden === 2`, `in` kept, `abs` and `up` gone.
  - `remoteOpenScript` run through local `/bin/sh -c` on the same good / corrupt / symlink archives: good → prints existing dir + `\0` + count, files present; corrupt → non-zero exit and the printed-or-created dir does not exist; symlink → count 2. Clean up the `/tmp` dirs in the test.
- [ ] **Step 2:** `npx vitest run test/archives.main.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `src/main/archives.ts`, IPC, preload, startup/quit cleanup.
- [ ] **Step 4:** `npm test && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** Commit `feat: archive caches in main`.

---

### Task 2: Shared archive rules

**Files:** Modify `src/shared/archives.ts`, `src/shared/menus.ts`; test `test/archives.test.ts`, `test/menus.test.ts`.

**Interfaces:**
- Consumes: `ArchiveLevel` (Task 1).
- Produces (`src/shared/archives.ts`):
  - `displayPath(path: string, levels: ArchiveLevel[]): string` — for each level from the innermost, replace the `root` prefix with `${level.archive} › `; outside any root, `path` unchanged. E.g. levels `[{archive:'/d/foto.zip', root:'/c/k1'}]`, path `/c/k1/2024/mare` → `/d/foto.zip › 2024/mare`; path `/c/k1` → `/d/foto.zip ›`. Nested: `[{archive:'/d/a.zip',root:'/c/k1'},{archive:'/c/k1/in/b.tar',root:'/c/k2'}]`, path `/c/k2/x` → `/d/a.zip › in/b.tar › x`.
  - `parentOf(path: string, levels: ArchiveLevel[]): { path: string; levels: ArchiveLevel[]; select?: string }` — inside the innermost root but not at it: plain parent, same levels. At the innermost root: `{ path: dirname(level.archive), levels: levels.slice(0, -1), select: level.archive }`.
  - `insideArchive(path: string, levels: ArchiveLevel[]): boolean` — true when `path` is the innermost root or below it.
- Produces (`src/shared/menus.ts`): `filesMenu` option `readOnly?: boolean` → keeps only ids `open`, `openWith:*`, `openWith:other`, `copy`, `copyPath`, `terminal`, `refresh` (and their separators, no leading/trailing/double separators); `actionsMenu` option `readOnly?: boolean` → only `terminal`, `refresh`.

- [ ] **Step 1: Failing tests:** the `displayPath` examples above (single, root itself, nested, path outside any root unchanged); `parentOf leaves the archive at its root`: at root → `{ path: '/d', levels: [], select: '/d/foto.zip' }`; at `/c/k1/2024` → `{ path: '/c/k1', levels }`; nested root `/c/k2` → `{ path: '/c/k1/in', levels: [first], select: '/c/k1/in/b.tar' }`; `insideArchive`; `filesMenu({ target: 'file', remote: false, readOnly: true, openWith: [{id:'a',name:'A'}] })` ids ⊆ allowed set and contain `open`, `copy`, `copyPath`; `target: 'background'` readOnly has no `newFile`/`paste`; no consecutive separators.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** Commit `feat: path and menu rules inside an archive`.

---

### Task 3: Archive mode in the Files tab

**Files:** Modify `src/renderer/FilesTile.tsx`, `src/renderer/FileSearch.tsx`, `src/renderer/App.tsx`, `src/renderer/EditorTile.tsx`, `src/renderer/Sidebar.tsx`, `src/shared/types.ts`, `src/renderer/styles.css`, `src/shared/locales/en.ts`, `README.md`.

**Interfaces:**
- Consumes: Task 1 preload calls; Task 2 `displayPath`, `parentOf`, `insideArchive`, `readOnly` menus.
- Produces: `FilesParams.archives?: ArchiveLevel[]` (persisted with the tab); `EditorParams.readOnly?: boolean`; DnD payload `{ host, paths, copyOnly?: true }`.

- [ ] **Step 1: Implement.**
  - `enterArchive(full)` in FilesTile (holder = the panel id `api.id`): show the overlay "Apro «name»…" with spinner + **Annulla** (`archiveCancel(api.id)`); on `ok` push `{ archive: full, root }` onto `archives`, `load(root)`, notice `{n} collegamenti esterni non mostrati` when `hidden > 0`; on error notice, stay.
  - Archives open by: double-click (list/icons/columns/gallery and search results), Enter, menu `open`, action bar "Apri {name}" — on a single non-dir entry where `isArchive`. Remove the current double-click → `extract` paths (FilesTile.tsx:574, :778; FileSearch `double` flag no longer needed if unused). "Estrai qui" stays in menu/action bar outside archives. `Apri con…` and multi-selection Apri unchanged.
  - `readOnly = insideArchive(here, archives)`: menus via `readOnly`; drops into the tab refused (`dropProps` returns no handlers); Cut, rename (F2), delete keys, new file/folder, paste, tags, Cmd+Z, Estrai qui disabled; drag-out payload `copyOnly: true`, and every drop target (FilesTile `dropProps`, Sidebar `dropFiles`) uses `copy` when `copyOnly`.
  - Path bar and tab title use `displayPath(here, archives)` (title: last segment of it). Copia percorso inside → `displayPath` of the item.
  - `up()` uses `parentOf`: leaving a level calls `archiveRelease(api.id, level.root)` and selects `select`. Home, sidebar `navigate`, Cmd+K, path change to a folder not `insideArchive` → release all levels (`archiveRelease(api.id)`) and clear `archives`.
  - Internal clipboard (`clip`, FilesTile.tsx:40): every assignment to `clip` first calls `archiveRelease('clipboard')`; a Copy while `readOnly` then calls `archiveHold('clipboard', host, <innermost root>)`. Put both in one small `setClip(next, root?)` helper so no assignment site is missed.
  - App: `api.onDidRemovePanel` → `window.api.archiveRelease(p.id)`; on App mount, before restoring the layout, `await window.api.archiveReleaseAll()`. A restored Files tab with `archives` re-opens each level in order via `archiveOpen` (spinner); if the outer archive is missing, fall back to its containing folder with notice `t('Archivio non trovato: {name}')`.
  - SSH: `Apri` inside an archive opens the editor with `readOnly: true` (EditorTile: CodeMirror `EditorState.readOnly.of(true)` + no save); "Modifica nell'editor" never offered inside.
  - Sidebar highlight: compare against the archive's containing folder when the active tab is inside an archive (pass `dirname(archives[0].archive)` as the active path).
  - README: Features → a short "Archives" paragraph (open as folder, read-only, take out by drag/copy; Estrai qui).
- [ ] **Step 2:** `npm test && npx tsc --noEmit -p . && npm run build` → PASS.
- [ ] **Step 3:** Manual checks for the user (list in report): open `.zip`/`.tar.gz` by double-click, Enter, Apri; spinner + Annulla on a big archive; path bar `foto.zip › …`; preview/gallery/search inside; drag a file out (copies, archive untouched); copy inside → leave → paste elsewhere works; up from root selects the archive; nested archive in/out; menus read-only; two tabs same archive; quit → `~/Library/Application Support/Cassetto/archives` empty; restart restores an archive tab; SSH archive open/leave/cancel; hostile symlink archive shows the notice.
- [ ] **Step 4:** Commit `feat: open archives as read-only folders`.
