# Base A: Sidebar, Undo, Open With

Date: 2026-11-17 · Status: draft for approval

## Intent

Cassetto is becoming a modular app: a clean file manager at its base, for people who work with files all day but don't live in a terminal, with opt-in "compartments" (Git, Claude Code, PowerToys-style tools) on top. Before any compartment, the base has to stop feeling like it's missing something when someone arrives from Finder, ForkLift or Path Finder. Base A covers the three gaps people notice in the first five minutes: **no sidebar of places, no Undo, no Open With**.

Roadmap context (agreed): Base A → Base B (copy queue, archives, PDF/video preview, batch rename) → module infrastructure + Git (ported from Tessera) → Claude Code → PowerToys-style compartments, folder compare.

## Goals

- A Finder-style sidebar: favourites, standard places, disks, SSH servers, tags.
- Cmd+Z undoes the last file operation, including restoring from the Trash.
- Right click → Open With lists the apps that can open a file.

## Non-goals

- Redo (Cmd+Shift+Z). Add later if asked for.
- Undo surviving an app restart.
- Undo of permanent deletes (remote or "delete for good"); the existing warning stays.
- Undo of tag edits, editor saves, or anything outside `files:op`.
- Open With for files on SSH hosts (they keep opening in Cassetto's editor).
- Making the sidebar a module: these are base features, always present.
- A Tags section in the sidebar. Today's tags are Finder tags (macOS only); a sidebar section would build the core UI on one OS's feature. Cross-platform tags are a separate topic for later.

## Anti-goals

- A sidebar per panel (option B) or no sidebar (option C): rejected in favour of one per window.
- Core behaviour that only works on one OS, or that needs another app (e.g. Finder) to be present.
- Needing Full Disk Access or Finder automation permission for any of this.
- Native Node modules for macOS APIs: use `osascript` (AppleScriptObjC / JXA) as the bridge.

## Constraints

- Electron 45, React 19, dockview; macOS (Apple Silicon) and Linux (AppImage). Everything must work on both, with platform differences called out below.
- UI strings go through `t()`/`tx()` with Italian keys and English in `src/shared/locales/en.ts`.
- Context menus are data (`src/shared/menus.ts`), shown natively by main.
- **Platform-neutral first.** Cassetto must stay installable on several platforms (macOS and Linux; Windows is not a target for now), so no feature may depend on one OS's software (Finder included). Rules: use Electron/Node cross-platform APIs before OS tools; every OS-specific behaviour sits behind one small module per capability in `src/main/platform/` (`trash.ts`, `openWith.ts`, `volumes.ts`), exporting the same functions with one implementation per OS, so a new platform means one implementation per file; a capability missing on a platform degrades (the UI entry is hidden or says so), it never breaks the rest.
- Every local and remote file operation already goes through one IPC handler, `files:op` (`src/main/index.ts:139` → `runOpLocal` / `runOpRemote` in `src/main/fileOps.ts`). Undo hooks in there.

## Approaches considered

**Where Undo lives**
- *Chosen: in main, around `files:op`.* All operations already route through it; main records the inverse of each item that succeeded. One place, every caller covered.
- Rejected: in the renderer per FilesTile. Each tile would track its own history, so Cmd+Z in another panel couldn't undo a move made from a drag, and every call site would need its own bookkeeping.

**Restoring from the macOS Trash** (spike done 2026-11-17)
- *Chosen: trash through `NSFileManager trashItemAtURL:resultingItemURL:error:` via AppleScriptObjC in `osascript`*, one call per batch. It returns the exact path in the Trash (including renamed duplicates such as `c.txt 21-38-59-090.txt`), ~0.2 s per batch, per-item errors. Moving a known path back out of `~/.Trash` works without Full Disk Access (listing `~/.Trash` does not).
- Rejected: `shell.trashItem` + searching `~/.Trash` (needs Full Disk Access to list it); Finder AppleScript `delete` (needs Automation permission, plays the Finder sound); moving files into `~/.Trash` ourselves (no system metadata at all).
- JXA was tried first and crashes (exit 139) reading the `resultingItemURL` out-parameter; AppleScriptObjC does not.
- Linux: keep `shell.trashItem` (gio) and locate the item through the freedesktop Trash: `~/.local/share/Trash/info/*.trashinfo` whose `Path=` matches the original and newest `DeletionDate`; files on other mounts use `$topdir/.Trash-$uid`.

**Listing apps for Open With**
- *Chosen: macOS `NSWorkspace URLsForApplicationsToOpenURL:` (+ `URLForApplicationToOpenURL:` for the default) via AppleScriptObjC; Linux `gio mime <type>` (type from `gio info -a standard::content-type` or `xdg-mime query filetype`) and the matching `.desktop` files.* No native modules.
- Rejected: a compiled Swift helper (adds a build step and signing for one feature).

## Design

### 1. Sidebar

- One per window, left of the dockview area.
- **Look** (chosen from mockups, 2026-11-17; files in `.superpowers/brainstorm/`):
  - **Expanded (default): floating panel.** Inset from the window edges with rounded corners, a slightly translucent surface (`backdrop-filter`), lucide line icons, the selected item as an accent-tinted pill, small bold section labels, a thin used-space meter under each disk.
  - **Collapsed: icon rail** (~44px). Places, disks and servers as icons; favourites as small rounded squares with their initial and colour; the name shows as a tooltip on hover. Same click/drag behaviour as expanded.
  - **Cmd+Alt+S** (Ctrl+Alt+S on Linux), a button at the top of the bar and an action-bar command switch expanded ↔ collapsed. No fully hidden state: the rail is the minimal form. Width (expanded) is resizable by dragging its edge. State and width persist in `AppState`.
  - **Optional "tiles" style for Favourites** (Settings → Barra laterale → Stile preferiti: Elenco | Tessere). With Tessere, the Favourites (and Places) show as a 2-column grid of coloured tiles at the top of the expanded bar; disks and servers stay a list below. Collapsed, both styles use the rail.
  - Favourites get a colour (right-click → Colore, the same six as tabs, `TAB_COLORS`); used by the rail squares and the tiles. Default: the accent.
- Sections, each collapsible (collapsed state persists):
  - **Favourites**: folders the user adds by dragging a folder onto the section, or with "Aggiungi ai preferiti" in the right-click menu and action bar. Reorder by dragging; remove from the item's right-click menu. May be folders on an SSH host (stored as `{ host, path, name?, color? }`).
  - **Places**: Home, Desktop, Documents, Downloads, Pictures, Music, Videos, from Electron's `app.getPath()` (cross-platform, follows XDG on Linux); a missing folder is not shown.
  - **Disks**: mounted volumes (`/Volumes/*` on macOS; `/media/$USER/*`, `/run/media/$USER/*`, `/mnt/*` on Linux) with an eject button (`diskutil eject` / `udisksctl unmount` + `power-off`, or `gio mount -e`). Refreshed when the window gains focus and every few seconds while visible.
  - **Servers**: hosts from `~/.ssh/config` (the existing `ssh:hosts`).
- Click opens in the active Files panel (or a new Files tab if the active tab isn't one, or if it is on a different host than the item: a Files tab stays on one host for life); Cmd+click opens a new tab; dragging an item onto a panel opens it there.
- Dropping files on a Favourite, Place or Disk moves them there (Option copies), reusing the existing transfer path, so it is undoable. Same host only, as today.
- The item matching the active panel's folder is highlighted.
- Keyboard: when focused, ↑↓ / Enter like other lists (`listNav`).

### 2. Undo

- Main keeps an in-memory stack (cap 50 entries) of **undo records**, one per successful `files:op` call. A record holds the host, a human label ("Spostati 3 elementi") and the inverse steps for the items that succeeded; failed items are not recorded.
- Inverses:
  - `mkdir` / `touch` → trash the created path. Remote (no Trash): remove only if still unchanged: a folder only if empty (`rmdir`), a file only if size and mtime still match those recorded right after the op; otherwise refuse and report.
  - `rename` → rename back.
  - `move` → move each item back (dest → src). If an item replaced something (`replace: true`), the replaced item was trashed: also restore it. Remote with `replace: true`: the replaced item was deleted for good, so such an op records no undo at all.
  - `copy` → trash the copies. Remote: same "only if unchanged" rule as `mkdir`/`touch` (size + mtime per file; a copied folder is removed only if every file in it still matches, otherwise refuse).
  - `trash` → move each item from its Trash path back to the original path.
  - `delete` → not undoable; nothing recorded.
- Undo refuses a step (and reports it, continuing with the others) if its target name is now taken or its source has gone; it never overwrites.
- `files:undo` IPC pops and runs the last record, returning `{ label, failed }`; the renderer shows a short toast "Annullato: <label>" or the failures in the existing error report. Panels showing affected folders refresh as they do after any op.
- Cmd+Z in a Files panel (not in the editor or terminal, which keep their own Cmd+Z) and an action-bar command "Annulla <label>" trigger it; the action-bar entry only appears when the stack isn't empty.
- On macOS, `trash` (and the replace-trash inside copy/move) switches from `shell.trashItem` to the AppleScriptObjC batch call so the Trash path is known. On Linux, the `.trashinfo` lookup runs right after `shell.trashItem`.

### 3. Open With

- Right-click on a local file: an "Apri con" submenu listing apps that can open it, the default first, each with its icon (`app.getFileIcon` on the app bundle / `.desktop` icon), then a separator and "Altra app…" (a file dialog filtered to applications).
- The same appears in the action bar for the selection: "Apri con <App>".
- Opening: macOS `open -a <app> <files>`; Linux the `.desktop` file's `Exec` via `gio launch <desktop-file> <files>`.
- Multiple selection: list only apps that can open all selected files.
- The app list is fetched when the menu opens; cache per content type for the session.

## Left to the builder

- Exact component split (e.g. `Sidebar.tsx`, `src/main/places.ts`, `src/main/undo.ts`, `src/main/openWith.ts`) and IPC names beyond `files:undo`.
- Exact sizes, spacing and translucency of the sidebar, within the look above and the existing colour tokens (both themes).
- Disk refresh interval.
- How the `osascript` scripts are shipped (inline strings vs files in resources).
- Tests: pure parts (inverse computation, `.trashinfo` parsing, mount listing parsing) get vitest tests in `test/`.

## Open risks

- The Trash spike ran from a terminal process; the packaged, ad-hoc-signed app has a different TCC identity. **First implementation step: confirm trash + restore inside the packaged app.** Fallback if it fails: Undo for trash on macOS is disabled with a clear message, everything else still works.
- Whether Finder's "Put Back" works for items trashed via `NSFileManager` is unverified; not required by this design.
