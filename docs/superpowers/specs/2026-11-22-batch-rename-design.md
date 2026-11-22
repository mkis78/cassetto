# Batch rename

Date: 2026-11-22 · Status: approved by the user ("sì, procedi") on the short design below.

## Intent
Rename many files at once, as other file managers do, so nobody misses it. Today rename is one item at a time (F2, menu; disabled with several selected).

## Goals
- With 2+ items selected, F2 / menu "Rinomina {n} elementi…" / action bar opens a dialog.
- Four modes, one at a time (Finder-like):
  - **Sostituisci testo**: find → replace with; option "Maiuscole/minuscole" (case-sensitive match, off by default); all occurrences.
  - **Aggiungi testo**: text before or after the name.
  - **Formato**: base name + progressive number, number before or after, minimum digits with leading zeros (1-6, default 2), start number (default 1); order = the current list order of the selection.
  - **Maiuscole/minuscole**: tutto minuscolo, TUTTO MAIUSCOLO, Iniziali Maiuscole.
- The extension is left alone unless "Includi estensione" is ticked (the rule then applies to the whole name). A name with no extension or a dot-file (`.env`) has no extension.
- Live preview list `old → new` (unchanged ones shown as "(invariato)"); errors in red: name empty/invalid (`nameError`), two items getting the same name, a new name that already exists in the folder and is not one of the renamed items. "Rinomina" disabled while there is any error or nothing changes.
- One operation, local and SSH, swaps and shifts included (a↔b, `foto 2`→`foto 3` while `foto 3` is renamed too); case-only renames work on case-insensitive disks.
- One Cmd+Z undoes the whole batch.

## Non-goals
Date tokens, combined rules, regex, renaming across folders (the selection is in one folder), metadata-based names.

## Anti-goals
Overwriting anything; a half-renamed batch left with temporary names.

## Approach (only sensible one)
Two phases inside one op: every item first gets a temporary name in its folder (`.cassetto-rename-<8 hex>-<i>`), then its final name, claimed without overwriting (local `place`; remote guarded `mv`). If any final step fails, the batch is rolled back: items already placed go back to their temporary names, then every temporary name back to its original. Renaming one by one was rejected (swaps would overwrite or fail half-way).

## Design
- Shared pure module: the four rules + extension handling + conflict check (used by the dialog's preview; main re-checks names that exist outside the batch).
- New FileOp `{ op: 'renameMany'; items: { from: string; to: string }[] }` (same folder) through the existing `files:op` (fast, not a queued job); undo step `renameMany` with the pairs reversed, run through the same op.
- Dialog in the Files tab, existing dialog styles; result refresh + selection of the renamed items.

## Left to the builder
Exact names/types, dialog layout within existing styles, rollback mechanics, tests (rules, conflicts, swap/shift/case-only local and via `/bin/sh` remote script, rollback on a mid-batch failure, undo).
