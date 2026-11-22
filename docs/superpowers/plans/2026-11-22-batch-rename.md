# Batch Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename several items of one folder at once with a previewed rule, as one undoable operation that never overwrites.

**Architecture:** Pure rules and conflict checks in `src/shared/batchRename.ts`; a `renameMany` FileOp in main (two-phase via temporary names, rollback on failure, local and remote) with its undo step; a dialog in the Files tab.

**Tech Stack:** Electron main (`node:fs/promises`), sh for remote, React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-batch-rename-design.md`

## Global Constraints

- macOS and Linux, local and SSH; local fs calls or argv-only commands; remote values via `shQuote`; remote scripts run through `runOpRemote`/`sshRun` like the other FileOps.
- Never overwrite: a final name is claimed atomically locally (reuse `place`/`taken` from `src/main/fileOps.ts`); remotely a guarded `mv` (check then mv, as `remoteOpScript` does, marked `ponytail:`).
- No temporary name may survive a finished op, success or failure (rollback).
- UI strings via `t('<Italian>')`, EN in `src/shared/locales/en.ts`. English commit messages, NO Co-Authored-By / Claude trailers.

## Review Focus

- Swap a↔b and shift (`f1→f2, f2→f3, f3→f4`) → all renamed, nothing lost (Task 2 tests).
- Case-only rename `a.txt → A.txt` on case-insensitive APFS → works (Task 2 test; `same` inode check exists in fileOps).
- A final name taken by a file outside the batch appearing after the preview (race) → whole batch rolled back to the original names, error reported (Task 2 `rollback`).
- Name with no extension / dot-file / "Includi estensione" off → extension untouched, dot-files treated as having no extension (Task 1 tests).
- Duplicate results within the batch (`Formato` with same base and digits ok; `Sostituisci` making two names equal) → preview error, button disabled (Task 1 `conflicts`).

---

### Task 1: Rename rules (shared)

**Files:** Create `src/shared/batchRename.ts`; test `test/batchRename.test.ts`.

**Interfaces (produces):**
```ts
export type RenameRule =
  | { kind: 'replace'; find: string; with: string; caseSensitive: boolean }
  | { kind: 'add'; text: string; where: 'before' | 'after' }
  | { kind: 'format'; base: string; where: 'before' | 'after'; start: number; digits: number }
  | { kind: 'case'; to: 'lower' | 'upper' | 'title' }
export function splitExt(name: string): [stem: string, ext: string] // 'a.tar.gz' → ['a.tar', '.gz']; '.env' → ['.env', '']; 'Makefile' → ['Makefile', '']
export function renamed(names: string[], rule: RenameRule, includeExt: boolean): string[] // same order; format numbers by index (see below)
export function conflicts(pairs: { from: string; to: string }[], existing: string[], fold: (s: string) => string): (string | null)[] // per item: t() error or null
```
- `format`: the new stem is `${base}${sep}${num}` for 'after' and `${num}${sep}${base}` for 'before', where `sep` is `' '` when base is non-empty, else `''`; `num = String(start + i).padStart(digits, '0')`.
- `replace` with empty `find` leaves names unchanged; case-insensitive replace matches regardless of case and inserts `with` verbatim; regex special characters in `find` are literal.
- `case: 'title'`: first letter of each word upper, the rest lower (words split on spaces, `-`, `_`).
- Applied to the stem only, unless `includeExt` (then to the whole name).
- `conflicts`: in order of precedence per item: `nameError(to)` (existing helper in `src/shared/fileOps.ts`) → `t('Nome doppio')` if another item gets the same folded name → `t('Esiste già')` if `fold(to)` is in `existing` and not the folded `from` of some item in the batch. Unchanged items (`to === from`) are never errors.

- [ ] **Step 1: Failing tests:** splitExt cases above; each rule on `['IMG_0001.jpg','IMG_0002.JPG','nota']` incl. includeExt on/off; replace case-insensitive `img_`→`Mare-`; literal `.` and `(` in find; format before/after, start 9 digits 2 → `09`,`10`; title case `ciao-mondo_bello file` → `Ciao-Mondo_Bello File`; conflicts: duplicate → 'Nome doppio' on both, existing outside batch → 'Esiste già', a swap (a→b, b→a with existing [a,b]) → no errors, invalid (`a/b`) → nameError text, case-only change with fold lower-case → no error.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** Commit `feat: batch rename rules`.

---

### Task 2: renameMany in main, with undo

**Files:** Modify `src/shared/types.ts` (FileOp), `src/main/fileOps.ts` (local + remote), `src/main/undo.ts` (inverse + step), `src/main/index.ts` (`files:op` validation if any); tests in `test/fileOps.main.test.ts`, `test/undo.test.ts`.

**Interfaces:**
- `FileOp |= { op: 'renameMany'; items: { from: string; to: string }[] }` (all in one folder; unchanged pairs are filtered out by the renderer).
- Local (`localOp`): phase 1 rename each `from` → `<dir>/.cassetto-rename-<8 hex>-<i>`; phase 2 place each temp → `to` with `place` (never overwrites; a case-only rename works because its `from` is already free). On the first failure in phase 1 or 2: undo what was done (placed → back to temp, temps → originals), report `failed: [{ path: <from of the failing item>, error }]` plus `t('Annullata la rinomina di tutti gli elementi')` for the others; on success `failed: []`.
- Remote (`remoteOpScript`): one script doing the same two phases with `mv`, guard `[ -e to ] || [ -L to ]` before each final mv, and a rollback section; reports `O`/`E` records like the other ops (`parseOpOutput`).
- `pathsOf` (fileOps.ts) covers renameMany (the `from`s).
- Undo: `inverseOf` for renameMany → `rec(named(n, …, 'Rinominato «{name}»', 'Rinominati {n} elementi'), [{ kind: 'renameMany', items: <reversed pairs> }])` when nothing failed; new `Step` kind `{ kind: 'renameMany'; items: { from: string; to: string }[] }` run in `runUndo` by calling `deps.local`/`deps.remote` with `{ op: 'renameMany', items }` (refresh dirs = the folder).

- [ ] **Step 1: Failing tests** (local real temp dirs, remote via `/bin/sh` as existing remote tests): plain batch; swap a↔b (contents follow names); shift f1→f2,f2→f3,f3→f4; case-only `a.txt→A.txt` (skip if the tmp fs is case-sensitive? it works either way: assert listing contains `A.txt` only); `rollback`: a `to` that exists outside the batch (create it after building the op) → nothing renamed, no `.cassetto-rename-*` left, error on that item; undo of a swap restores both; `inverseOf` label for 1 and n items.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** Commit `feat: rename many items at once, undoable`.

---

### Task 3: Batch rename dialog

**Files:** Create `src/renderer/BatchRename.tsx`; modify `src/renderer/FilesTile.tsx`, `src/shared/menus.ts`, `src/renderer/styles.css`, `src/shared/locales/en.ts`, `README.md`; `test/menus.test.ts`.

**Interfaces:** Consumes Task 1 (`RenameRule`, `renamed`, `conflicts`) and Task 2 (`renameMany` op via `window.api.fileOp`).

- [ ] **Step 1: Implement.**
  - menus.ts: the `rename` item is enabled for any count ≥ 1; label `t('Rinomina')` for 1, `t('Rinomina {n} elementi…', { n })` for more; test updated.
  - FilesTile: F2 / menu `rename` / action bar entry with 2+ selected (not in an archive: `readOnly` keeps it hidden) → opens `<BatchRename names={selected names in list order} existing={names in the folder} fold={the tile's fold} onApply={pairs => …} onClose />`. Apply: `window.api.fileOp(host, { op: 'renameMany', items: changed pairs as full paths })`, `report(result)`, `changed(api.id, [dir])`, refresh and select the renamed items.
  - BatchRename: mode select (Sostituisci testo / Aggiungi testo / Formato / Maiuscole e minuscole) with its fields; "Includi estensione" checkbox; preview list `old → new` with unchanged as `t('(invariato)')` and per-row error text in the danger color; buttons Annulla / Rinomina (disabled when any error or no change); Enter applies, Esc closes. Defaults: replace empty; add after; format base = `t('File')`, after, start 1, digits 2; case lower. Reuse the existing dialog styles (look at FileDialogs.tsx / SettingsDialog for classes).
  - README: Features → one line under files: batch rename with preview, swaps work, one Cmd+Z.
- [ ] **Step 2:** `npm test && npx tsc --noEmit -p . && npm run build` → PASS.
- [ ] **Step 3: Manual checks for the user (in report):** select 5 photos → Formato "Mare" → `Mare 01.jpg…`; swap two names with Sostituisci; case-only rename on the Mac; a conflict shows red and disables Rinomina; Cmd+Z restores all; same on an SSH server.
- [ ] **Step 4:** Commit `feat: batch rename dialog`.
