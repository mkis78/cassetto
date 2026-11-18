# Copy Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy and move run as cancellable jobs with byte progress, queued per route, and can go between the Mac and SSH servers.

**Architecture:** `src/main/jobs.ts` owns the queue (routes, states, snapshots, cancel). Workers do the copying: `src/main/copyLocal.ts` (same-host local, byte counting), `src/main/copyRemote.ts` (same-host remote, item by item + `du` polling), `src/main/transfer.ts` (between hosts, tar stream piped through main). The renderer starts jobs instead of awaiting `fileOp`, and shows a Transfers popover in the top bar.

**Tech Stack:** Electron 45 main (`node:child_process` spawn, `node:fs/promises`, streams), React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-11-19-copy-queue-design.md`

## Global Constraints

- macOS and Linux, local and SSH hosts; no native modules; local commands argv-only (`spawn`/`execFile` with an args array), remote values via `shQuote`; ssh with `sshOptions()` + `-o BatchMode=yes -o ConnectTimeout=8` and the script wrapped by `remoteSh()` (as `sshRun` in `src/main/ssh.ts`).
- Never overwrite: only items with `replace: true` may displace an existing destination, which goes to the Trash locally (`trashItems`) or is removed remotely (`rm -rf`), as `src/main/fileOps.ts` does today.
- A cancelled or failed item leaves nothing at its destination (partial file, partial folder, `.cassetto-part-*` temp folder are removed) and never removes its source.
- No rsync, scp, pv: only `tar`, `sh`, `du`, `mkdir`, `mv`, `rm`, `kill` on hosts.
- UI strings via `t('<Italian>')`, EN in `src/shared/locales/en.ts`. English commit messages, NO Co-Authored-By / Claude trailers.

## Review Focus

- Cancel in the middle of a big file / folder → no partial destination left, source intact (Task 2 `cancel removes the partial item`, Task 4 `cancel removes the part folder`).
- Destination name taken after the conflict dialog (race) → item fails "Esiste già", nothing overwritten (Task 2 / Task 4 `never overwrites`).
- Move between machines where the upload fails half-way → source still there (Task 4 `failed move keeps the source`).
- Two jobs on the same route → second waits for the first; jobs on different routes run together (Task 1 `routes`).
- macOS source to Linux server → no `._*` AppleDouble files at the destination (Task 4 env `COPYFILE_DISABLE=1`; manual check).

---

### Task 1: Job queue in main

**Files:** Create `src/main/jobs.ts`, `src/shared/jobs.ts`; modify `src/main/index.ts`, `src/preload/index.ts`; test `test/jobs.test.ts`.

**Interfaces (produces):**
- `src/shared/jobs.ts`:
  ```ts
  export type JobItem = { src: string; dest: string; replace: boolean }
  export type JobSpec = { op: 'copy' | 'move'; from: string | null; to: string | null; items: JobItem[] }
  export type JobState = 'queued' | 'measuring' | 'running' | 'done' | 'failed' | 'cancelled'
  export type JobSnapshot = { id: string; spec: JobSpec; state: JobState; bytes: number; total: number | null; current: string | null; failed: { path: string; error: string }[]; started: number | null; ended: number | null }
  export const routeOf = (s: Pick<JobSpec, 'from' | 'to'>): string => `${s.from ?? 'local'}>${s.to ?? 'local'}`
  ```
- `src/main/jobs.ts`:
  - `export type Progress = { total(n: number | null): void; add(bytes: number): void; item(name: string | null): void; fail(path: string, error: string): void }`
  - `export type Worker = (spec: JobSpec, p: Progress, signal: AbortSignal) => Promise<void>` (throwing = job `failed` with the error recorded on the job as a failure of its first item path; abort = `cancelled`).
  - `export class JobQueue { constructor(o: { worker: Worker; emit: (jobs: JobSnapshot[]) => void; throttleMs?: number /* default 250 */ }); start(spec: JobSpec): string; cancel(id: string): void; clear(): void /* drops done|failed|cancelled */; list(): JobSnapshot[]; running(): boolean /* any queued|measuring|running */ }` — jobs with the same `routeOf` run one after another in start order; different routes concurrently. `state` goes `queued → measuring` (worker started, before first `total`) `→ running` (after `total`) `→ done` (no failures) | `failed` (worker threw, or any `fail`) | `cancelled`. `emit` is called at most once per `throttleMs` for progress, and immediately on every state change. Cancelling a queued job marks it `cancelled` without running it.
- IPC (index.ts) + preload: `jobs:start(spec) → id` / `jobStart(spec)`, `jobs:cancel(id)` / `jobCancel(id)`, `jobs:clear()` / `jobClear()`, `jobs:list() → JobSnapshot[]` / `jobList()`, event `jobs` → preload `onJobs(cb: (jobs: JobSnapshot[]) => void): () => void`. Validate `spec` shape in the handler (op, items array of strings/booleans, hosts via `isValidHost` or null) and reject otherwise.
- The worker wired in index.ts for this task is a dispatcher stub that throws `t('Non ancora disponibile')`; Tasks 2-4 replace its branches: same host local → `copyLocal`, same host remote → `copyRemote`, different hosts → `transfer`.
- Quit: in the existing `before-quit` handler, if `queue.running()`, `e.preventDefault()` and show `dialog.showMessageBox(win, { type: 'warning', buttons: [t('Esci'), t('Annulla')], defaultId: 1, cancelId: 1, message: t('Ci sono trasferimenti in corso.'), detail: t('Uscendo verranno annullati.') })`; on Esci cancel all, wait for them to settle (max 5 s), then `app.quit()` again (a flag avoids asking twice).

- [ ] **Step 1: Failing tests** (`test/jobs.test.ts`, fake workers with controllable promises, `vi.useFakeTimers` for throttle):
  - `routes`: two jobs local>local: second stays `queued` until the first resolves; a local>h1 job runs at the same time as a local>local one.
  - `states`: worker calls `total(100)`, `add(40)`, `add(60)` → snapshots show `measuring`, `running` with bytes 40 then 100, then `done`; a worker calling `fail('a','x')` ends `failed` with `failed: [{ path: 'a', error: 'x' }]`; a throwing worker ends `failed`.
  - `cancel`: cancelling a running job aborts the signal and ends `cancelled` (even if the worker then resolves); cancelling a queued one never calls the worker; `clear()` removes only ended jobs.
  - `throttle`: many `add` within 250 ms → one progress emit; a state change emits immediately.
- [ ] **Step 2:** `npx vitest run test/jobs.test.ts` → FAIL. **Step 3:** implement + IPC + preload + quit confirmation. **Step 4:** `npm test && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** Commit `feat: job queue for copies and moves`.

---

### Task 2: Same-host local copy with byte progress

**Files:** Create `src/main/copyLocal.ts`; modify `src/main/fileOps.ts` (export `place`, `fresh` if needed), `src/main/index.ts` (dispatcher branch + undo record); test `test/copyLocal.test.ts`.

**Interfaces:**
- Consumes: `JobSpec`, `Progress` (Task 1); `trashItems` (index.ts), `inverseOf`/`UndoStack` (`src/main/undo.ts`).
- Produces: `copyLocal(spec: JobSpec, p: Progress, signal: AbortSignal, trash: (paths: string[]) => Promise<Trashed[]>): Promise<{ done: JobItem[]; trashed: Trashed[] }>`.
  - Total: sum of `lstat` sizes of regular files under every src (symlinks not followed) → `p.total`.
  - Per item `p.item(basename(src))`. Replace items: their existing destinations go to the Trash first, all together, as `localOp` does (`src/main/fileOps.ts:84-87`); a refused trash fails that item.
  - Copy: claim `dest` first (dir: `mkdir`; file: write with flag `wx`; symlink: `symlink` which fails on EEXIST) then recurse; files < 64 MiB via `copyFile(s, d, COPYFILE_FICLONE)` then `p.add(size)`; larger via `pipeline(createReadStream, counter, createWriteStream(d, { flags: 'wx' }))` adding bytes as chunks pass; keep file mode.
  - Move: `place(src, dest)` (rename, counts the item's size at once); on `EXDEV` copy as above then trash the source at the end (as today).
  - `signal` aborted: stop at the next chunk/file, remove the partial destination of the current item (`rm -rf` of what this item created), throw an `AbortError`; items done before stay.
  - Per-item errors → `p.fail(src, message)`; the item's partial destination removed; continue with the next item.
- index.ts: dispatcher same-host local → `copyLocal`; afterwards push `inverseOf(null, { op, items: done }, new Set(), trashed, new Map())` to `undos` when it returns a record (also after cancel/failure, for the completed items).

- [ ] **Step 1: Failing tests** (real temp dirs):
  - copies a tree (nested dirs, a 70 MiB file made with `truncate`/`writeFile(Buffer.alloc)`, a symlink) → contents equal, symlink target verbatim, `add` sums to `total`.
  - `never overwrites`: dest created between "conflict check" and run (pre-create it) with `replace: false` → `fail('…','Esiste già')`, existing content untouched.
  - replace: existing dest goes through the injected `trash` and is replaced.
  - move same volume: src gone, dest present; EXDEV path covered by injecting? (skip if not reproducible; test the copy-then-trash helper directly).
  - `cancel removes the partial item`: abort while the 70 MiB file streams (abort from the counter after first chunk) → rejects AbortError, dest of that item absent, src intact, earlier item still present.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** Commit `feat: local copies with byte progress and cancel`.

---

### Task 3: Same-host remote copy, item by item

**Files:** Create `src/main/copyRemote.ts`; modify `src/main/index.ts` (dispatcher branch + undo stamps as `files:op` does); test `test/copyRemote.test.ts`.

**Interfaces:**
- Consumes: `remoteOpScript` (`src/main/fileOps.ts`), `sshOptions`, `remoteSh`, `shQuote`, `isValidHost` (`src/main/ssh.ts`).
- Produces: `copyRemote(spec: JobSpec, p: Progress, signal: AbortSignal, run: Runner): Promise<{ done: JobItem[] }>` with `export type Runner = (script: string, signal?: AbortSignal) => Promise<{ code: number; out: string; err: string }>` (production: spawn ssh to `spec.from` with the script via `remoteSh`; tests: spawn `/bin/sh -c script`).
  - Total: one script `du -sk -- <srcs…>` summed ×1024 → `p.total` (`null` if it fails).
  - Each item runs `remoteOpScript({ op, items: [item] })` wrapped so the remote shell prints its pid first (`echo $$` then `exec` the step in a subshell group) and parse with `parseOpOutput`; `p.item(name)`; failure → `p.fail`.
  - While an item runs, every 2 s `du -sk -- <dest>` → `p.add(delta)` (bytes never go backwards; when the item ends, add the remainder up to its measured size).
  - Cancel: kill the local ssh/sh child, then `run('kill -TERM -<pid> 2>/dev/null; kill -TERM <pid> 2>/dev/null; rm -rf -- <dest of current item>')` for a non-replace copy item (never for a move: `mv` within one host is atomic per item, so no partial dest) → throw AbortError.
- index.ts: undo record for the done items exactly like the `files:op` handler (stamps for copy).

- [ ] **Step 1: Failing tests** (Runner = local `/bin/sh`): copies two items, `item` called per item, `add` total ≥ files' bytes; an item whose dest exists → `fail` with `Esiste già`, nothing overwritten; `cancel` during a slow item (a fake `cp` on PATH that sleeps) → AbortError, its dest absent, the kill script ran.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** Commit `feat: remote copies item by item with progress and cancel`.

---

### Task 4: Transfers between machines

**Files:** Create `src/main/transfer.ts`; modify `src/main/index.ts` (dispatcher branch); test `test/transfer.test.ts`.

**Interfaces:**
- Produces: `transfer(spec: JobSpec, p: Progress, signal: AbortSignal, sides: { spawn(host: string | null, script: string): ChildProcess; trash(paths: string[]): Promise<Trashed[]> }): Promise<void>`.
  - Production `spawn`: host null → `spawn('/bin/sh', ['-c', script], { env: { ...process.env, COPYFILE_DISABLE: '1' } })`; host → `spawn('ssh', [...sshOptions(), '-o','BatchMode=yes','-o','ConnectTimeout=8', host, '--', remoteSh(script)])`. Tests: both sides `/bin/sh` in temp dirs (the "remote" path just being another temp dir).
  - Total: per item, a measure script on the source side (`du -sk -- <src>`) → sum ×1024.
  - Per item (`p.item(name)`):
    1. destination side: `d=<parent of dest>/.cassetto-part-<8 hex>; mkdir -- "$d" && tar -xf - -C "$d"` (stdin from the pipe);
    2. source side: `cd -- <parent of src> && tar -cf - -- <basename src>` (on a macOS source add `--no-mac-metadata` only if `tar --help` would accept it: simply rely on `COPYFILE_DISABLE=1` for local; for remote sources the env var is set in the script: `COPYFILE_DISABLE=1 tar …`);
    3. pipe source stdout → counter (`p.add(chunk.length)`) → destination stdin; both must exit 0;
    4. destination side, one script: if `replace`: `rm -rf -- <dest>` (remote) or trash it via `sides.trash` first (local destination); else fail `Esiste già` if dest exists; then `mv -- "$d/<name>" <dest> && rmdir -- "$d"` (on any failure `rm -rf -- "$d"`).
    5. `op === 'move'` and the item placed: remove the source (`sides.trash([src])` if `from` is null, else `rm -rf -- <src>` on the source side). A failed trash/remove is reported as `p.fail(src, t('Copiato, ma l\'originale non è stato rimosso: {error}', { error }))`.
  - Any step failing → `p.fail(src, stderr || message)`, `rm -rf` the part folder, next item. Cancel → kill both children, run `rm -rf -- <part folder>` on the destination side, throw AbortError.
  - The destination name is never written except by the final `mv`, which is guarded by the existence check in the same script (`ponytail:` check-then-mv, as `remoteOpScript`).
- index.ts dispatcher: `from !== to` → `transfer`. No undo record.

- [ ] **Step 1: Failing tests** (`/bin/sh` both sides): copies a folder with nested files and a symlink to another temp dir, bytes ≥ content size, no `.cassetto-part-*` left; `never overwrites` (dest exists, replace false → fail, untouched); replace true removes the old one; move removes the source only after success; `failed move keeps the source` (destination `tar` replaced by a failing command via PATH or a read-only dest dir) → source intact, no part folder; `cancel removes the part folder` (slow source: a `tar` wrapper that sleeps before streaming) → AbortError, no part folder, source intact.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** Commit `feat: copy and move between machines`.

---

### Task 5: Transfers in the UI

**Files:** Modify `src/renderer/FilesTile.tsx`, `src/renderer/Sidebar.tsx`, `src/renderer/App.tsx`, create `src/renderer/Transfers.tsx`; `src/renderer/styles.css`, `src/shared/locales/en.ts`, `README.md`.

**Interfaces:** Consumes preload `jobStart`, `jobCancel`, `jobClear`, `jobList`, `onJobs` and `JobSnapshot`/`routeOf` (Task 1).

- [ ] **Step 1: Implement.**
  - FilesTile `transfer(mode, srcs, destDir, …)`: takes the source host (`fromHost`); the conflict pre-check lists `destDir` on this tab's host (as today); builds items as today; calls `window.api.jobStart({ op: mode, from: fromHost, to: host, items })` instead of `fileOp`; a notice is not shown. Paste uses the clipboard's host (remove the `clipFor` "other-host" refusal); a drop accepts `dragging.host !== host` and then always copies (`dropEffect = 'copy'`), Cut+Paste across hosts moves. Remove the `ponytail: no drops across hosts` note. Archive caches stay read-only sources (copyOnly).
  - Sidebar `dropFiles`: same, via `jobStart` (from = the dragged host, to = the item's host).
  - When a job's snapshot reaches an ended state, call `changed('jobs', [dest dirs (+ source dirs for move)])` once per job (App subscribes `onJobs`).
  - `Transfers.tsx`: top-bar button shown while `jobList` has jobs; icon with a ring (`conic-gradient`) of overall bytes/total of active jobs; popover rows: name (`basename` of first item, `+{n}` when more), `from → to` (`Mac`/host names; `t('questo Mac')`), bar, `formatSize(bytes) di formatSize(total) · {speed}/s · {eta}` (speed/eta from the last snapshots, in the component), state label (`In coda`, `Calcolo…`, `Annullato`, `{n} non riusciti` expandable list), `Annulla` per active job, `Pulisci` for ended ones. Reuse the existing size formatter in the renderer (grep `formatSize`/`humanSize`).
  - README: Features → "Transfers" paragraph (progress, cancel, between Mac and servers by drag or copy/paste, copies across machines by default, Cut+Paste moves; no undo for transfers between machines).
- [ ] **Step 2:** `npm test && npx tsc --noEmit -p . && npm run build` → PASS.
- [ ] **Step 3: Manual checks for the user (list in report):** big local copy shows progress and Annulla leaves nothing behind; two copies queue; drag Mac → server and back; Cut on server + Paste on Mac moves; conflict dialog across hosts; macOS → Linux server has no `._` files; quit during a transfer asks; undo after a local copy still works.
- [ ] **Step 4:** Commit `feat: transfers popover, copies and moves between machines from the UI`.
