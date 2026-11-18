# Copy queue and transfers between machines

Date: 2026-11-19 · Status: decided by Claude on the user's behalf ("procedi tu"); the user reviews the result.

## Intent

Today a copy or move is one IPC call that Cassetto simply awaits: no progress, no cancel, a second operation runs in parallel with the first, and nothing can go between the Mac and an SSH server (FilesTile.tsx `dropProps`: "no drops across hosts"). The user lives on SSH servers (Tessera, terminal, Claude Code), so big copies and uploads/downloads are the everyday case where the lack shows. Goal: every copy/move becomes a visible job with progress and Cancel, and files can be copied or moved between the Mac and a server, or between two servers, with the same gestures as today.

## Goals

- Copy and move (paste, drop on a folder or the sidebar) run as **jobs** in main: queued, one at a time per route, with progress (bytes done / total, speed, time left, current item) and **Annulla**.
- **Between machines**: drag from a local tab to a server tab (and back, and server to server), or Copy/Cut in one and Paste in the other. Across machines a drop **copies** by default (Alt is not needed); Cut + Paste moves.
- A **Trasferimenti** indicator in the top bar: hidden when idle; while jobs run, a small ring with the overall percent; click → popover listing jobs (name, from → to, bar, `12,4 MB di 1,2 GB · 8 MB/s · 2 min`, Annulla), finished ones with their result (errors per item) until cleared ("Pulisci").
- Quitting with jobs running asks for confirmation ("Ci sono trasferimenti in corso. Uscire e annullarli?").

## Non-goals

- Pause/resume, reordering the queue, resuming a broken transfer from where it stopped (a failed job is re-run by the user).
- Trash, delete, extract, rename, mkdir: they stay as today (fast, or with their own UI).
- Undo for jobs between machines (same-host copy/move keep today's undo, recorded for the items that completed).

## Anti-goals

- Overwriting anything not chosen by the user in the conflict dialog (Base A rule: never overwrite).
- A cancelled or failed job leaving half-written files at the destination.
- Depending on tools a stock macOS or Linux host lacks (no rsync, no scp-specific flags, no pv).

## Constraints

- macOS and Linux, local and remote hosts; argv-only `execFile`/`spawn` locally, `shQuote` remotely; ssh via the existing ControlMaster options (`sshOptions()` in `src/main/ssh.ts`).
- Conflict handling stays in the renderer exactly as today (`transfer()` in FilesTile.tsx lists the destination, asks Sostituisci / Mantieni entrambi / Salta); the job receives the resolved `items: { src, dest, replace }[]`.
- UI strings via `t()`, EN in `src/shared/locales/en.ts`.

## Approaches considered

- **A. Main-side job queue; same host uses an item-by-item copy that counts bytes; between machines streams a tar archive through main (chosen).** `tar -cf -` on the source side piped by Node into `tar -xf -` on the destination side, counting bytes as they pass. Works for local↔server and server↔server with stock tools, gives exact progress, one ssh connection per side.
- B. scp/sftp per file. Progress only by parsing scp's terminal output (needs a pty), per-file connections are slow for many small files, and scp's flags differ between OpenSSH versions. Rejected.
- C. rsync. Best resume and progress, but not present on every server and macOS ships an old or different rsync. Rejected (could be an opt-in later).

## Design

### Jobs (main)
- `jobs:start(job)` where `job = { op: 'copy' | 'move'; from: host | null; to: host | null; items: { src, dest, replace }[] }` returns a job id immediately; the renderer no longer awaits the copy itself.
- Routes: `${from ?? 'local'}>${to ?? 'local'}`; jobs on one route run in order, different routes in parallel.
- Each job: `measuring` (total bytes: local walk with lstat; remote `du -sk` per item, so an estimate) → `running` → `done` | `failed` | `cancelled`, with `bytes`, `total`, `current` (item name), per-item `failed: { path, error }[]`. Speed/time left computed in the renderer from successive snapshots.
- Main pushes snapshots on a `jobs` channel, at most ~4 per second, and a final one per state change. `jobs:cancel(id)`, `jobs:clear()` (drops finished jobs).
- When a job ends, the renderer refreshes the tabs showing its source/destination folders (today's `changed(...)` mechanism).

### Same host
- Local: own recursive copy instead of `fs.cp` so bytes can be counted: directories created, symlinks recreated verbatim, files copied with `copyFile` (COPYFILE_FICLONE, instant on APFS) under 64 MB and with a counting stream above. Move: `place()` as today (rename); across volumes (EXDEV) copy + Trash the original, as today. The never-overwrite claim rules of `src/main/fileOps.ts` (`fresh`, `place`, replaced destinations to the Trash first) are kept.
- Remote: today's per-item script, run item by item so `current` and per-item results stream; bytes from polling `du -sk` of the destinations every 2 s over the same ControlMaster connection.
- Cancel: local stops between files and removes the partial item being written; remote kills the running command (the script prints its pid first; cancel runs `kill` on that process group) and removes the partial destination of the current item. Items already done stay done and are reported.
- Undo: recorded as today (`inverseOf`) for the items that completed.

### Between machines
- Each item: source `tar -cf - -C <parent> <name>` (local spawn, or ssh), destination `tar -xf - -C <tmp>` where `<tmp>` is a fresh `.cassetto-part-<random>` folder in the destination folder (local mkdir, or remote `mkdir`), piped through main with a byte counter. On macOS the source tar runs with `COPYFILE_DISABLE=1` (no `._` files) and `--no-mac-metadata` when supported.
- After a successful item: move `<tmp>/<name>` to its destination name without overwriting (local `place`, remote `mv` guarded like `remoteOpScript`); a `replace` item first sends the old destination to the Trash (local) or removes it (remote, as today's remote replace), then removes `<tmp>`.
- Move between machines: after an item is placed, its source is sent to the Trash (local) or removed (remote, `rm -rf`). A failed or cancelled item never removes its source.
- Cancel/failure: kill both sides, remove `<tmp>`. Leftover `.cassetto-part-*` folders from a crash are visible and can be deleted by hand (`ponytail:`).
- No undo for these jobs (the popover says nothing; Cmd+Z skips them).

### UI
- `transfer()` in FilesTile (and the Sidebar drop) builds the items as today and calls `jobs:start` instead of `fileOp`; drops/pastes across hosts are allowed (the conflict pre-check lists the destination host).
- Top bar: `Transfers` button (icon with ring) only while jobs exist; popover as in Goals. Errors: the job row shows "N non riusciti" expandable to the list.
- A job that takes more than ~1 s shows in the popover without opening it; nothing modal.

## Left to the builder
- Exact IPC/event names, snapshot shape beyond the fields above, throttling mechanics.
- How the remote per-item script exposes its pid and how cancel kills it.
- Popover look within existing styles (dockview/topbar CSS).
- Tests: local copy byte counting and cancel cleanup; never-overwrite with replace; tar pipe between two "hosts" simulated with local `/bin/sh` (as other remote tests do); route serialization; cancel removing `.cassetto-part-*`.
