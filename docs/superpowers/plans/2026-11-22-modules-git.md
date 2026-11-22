# Compartments + Git Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in built-in compartments switched on in Settings, and the first one: Tessera's Git tile, ported to Cassetto.

**Architecture:** `Settings.modules` gates every UI entry point of a compartment; the dockview always knows the `git` component so saved layouts render (a notice when off). Git is ported from Tessera (`/Users/marcopennisi/PROGETTI_PERSONALI/tessera`): main-side `git` CLI wrapper + IPC, renderer tile, diff view rebuilt on `@codemirror/merge`.

**Tech Stack:** Electron 45, React 19, dockview, CodeMirror 6 (+ `@codemirror/merge`), vitest, `git` CLI via `spawn`.

**Spec:** `docs/superpowers/specs/2026-11-22-modules-git-design.md`

## Global Constraints

- macOS + Linux; `git` spawned with argv (no shell); nothing depends on one OS's software.
- Every UI string through `t('<Italian>')` (or `tx` for module-level constants), English added in `src/shared/locales/en.ts` (Tessera strings are raw Italian: wrap them all). Menus as data in `src/shared/menus.ts`.
- Styles in `src/renderer/styles.css` with Cassetto's existing CSS variables (check both themes); icons from `lucide-react` with `ICON` from `./icons`.
- Git compartment off by default. Off = no menu entry, no action-bar entry, no palette command. Git is local only: no Git entry on SSH tabs.
- No Claude features from Tessera (`sendToClaude`, `claudeTarget`, "Claude Code qui", worktree creation).
- English commit messages, NO Co-Authored-By / Claude trailers.

## Review Focus

- Folder that is not a git repository, or `git` not installed → the Git tile shows a clear message ("Non è un repository git" / "Serve git…"), never a blank tile or an unhandled rejection (Task 3 test on main side: `gitStatus` of a plain temp dir resolves to a not-a-repo result).
- Restored layout with a Git tab while the compartment is off → the tab shows "Lo scomparto Git è disattivato" + "Attiva"; turning it on renders the tile without reopening (Task 1).
- Destructive actions (reset --hard, discard, forced worktree removal, branch delete) → confirmation kept from Tessera (Task 3 review).
- Repository path with spaces/unicode, branch names with `/` → work (Task 2 tests use such a temp repo path).
- Huge diff / binary file in the diff view → no freeze: binary shows a notice, texts over the existing editor size limit are not loaded (Task 4).

---

### Task 1: Compartments in Settings, Git tab kind with the disabled notice

**Files:** Modify `src/shared/types.ts`, `src/renderer/settings.ts`, `src/renderer/SettingsDialog.tsx`, `src/renderer/App.tsx` (components), `src/shared/locales/en.ts`; create `src/renderer/modules.ts`, `src/renderer/GitTile.tsx` (placeholder only); test `test/modules.test.ts`.

**Interfaces (produces):**
- `Settings.modules?: { git?: boolean }`.
- `export type GitParams = { kind: 'git'; cwd: string; name?: string; color?: TabColor }`, added to `TileParams`.
- `src/renderer/modules.ts`: `export type ModuleId = 'git'`; `export const MODULES: { id: ModuleId; name: string; description: string }[]` (Git: `tx('Git')`, `tx('Rami, commit e modifiche di un repository, in un tab')`); `export const moduleOn = (s: Settings, id: ModuleId): boolean` (false when unset); `export const useModule = (id: ModuleId): boolean` (re-renders on settings change, via `onSettings`/`getSettings` in settings.ts); `export const setModule = (id, on)`: changes the setting through the same path the Settings dialog uses (App owns `state.settings`: expose it as a window event `cassetto:setModule` that App handles, or an equivalent the builder picks).
- `src/renderer/tiles.ts`: `export function openGit(api: DockviewApi, cwd: string, nextTo?: string): void` (component `git`, title = folder base name).
- `GitTile` default export registered as `git` in App's `components`. In this task its body is: when `useModule('git')` is false → notice `t('Lo scomparto Git è disattivato')` + button `t('Attiva')` (calls `setModule('git', true)`); else a placeholder `files-empty` text with the cwd (replaced in Task 3).

- [ ] **Step 1: Failing tests** in `test/modules.test.ts`: `moduleOn({ theme: 'system' }, 'git') === false`; `moduleOn({ theme: 'system', modules: { git: true } }, 'git') === true`; `MODULES` contains `git`.
- [ ] **Step 2:** run `npx vitest run test/modules.test.ts` → FAIL. **Step 3:** implement, plus a "Scomparti" section in SettingsDialog: one checkbox per `MODULES` entry with its description under it.
- [ ] **Step 4:** `npm test && npx tsc --noEmit -p . && npm run build` → PASS.
- [ ] **Step 5:** Commit `feat: compartments switched on in Settings; git tab kind`.

---

### Task 2: Git in main (ported)

**Files:** Create `src/main/git.ts`, `src/shared/graph.ts`, `src/shared/gitView.ts`, `src/shared/refName.ts`, `test/git.test.ts`, `test/graph.test.ts`; modify `src/shared/types.ts` (git types), `src/main/index.ts` (handlers), `src/preload/index.ts` (API).

Port from Tessera's files of the same names (`src/main/git.ts`, `src/shared/{graph,gitView,refName}.ts`, git types in `src/shared/types.ts` lines 77–190, `test/git.test.ts`, `test/graph.test.ts`). Changes:
- Drop `gitWorktreeAdd` and its handler/test; keep `worktreeRemove` in `GitAction`.
- `readLocal` comes from Cassetto's `src/main/files.ts` (check its result type matches what `gitDiffTexts` expects; adapt).
- Error strings returned to the UI through `t()`.
- `gitStatus` on a folder that is not a repository, and when `git` is missing (ENOENT on spawn), resolves (never rejects) to a result the tile can show: add `GitStatus.error?: 'not-repo' | 'no-git'` (or the shape Tessera already uses for this — reuse if present).

**Interfaces (produces), preload `window.api`:** `gitLog(cwd, v: LogView): Promise<Commit[]>`, `gitStatus(cwd): Promise<GitStatus>`, `gitRun(cwd, a: GitAction): Promise<GitResult>`, `gitChanges(cwd): Promise<Changes>`, `gitCommit(cwd, sha): Promise<CommitInfo | null>`, `gitRefs(cwd): Promise<GitRefs>`, `gitDiff(cwd, d: DiffSpec): Promise<DiffTexts>`; IPC channels `git:log|status|run|changes|commit|refs|diff`.

- [ ] **Step 1:** Port the tests; make the temp repo path contain a space and `è` (e.g. `mkdtemp(join(tmpdir(), 'repo è '))`); add: `gitStatus` of a plain temp dir → `error: 'not-repo'`; a branch named `feat/x` is listed in `gitRefs` and can be checked out via `gitRun`.
- [ ] **Step 2:** run → FAIL. **Step 3:** port + adapt. **Step 4:** `npm test && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** Commit `feat: git in main, ported from Tessera`.

---

### Task 3: Git tile (ported) and entry points

**Files:** Modify `src/renderer/GitTile.tsx` (replace placeholder), create `src/renderer/GitPanels.tsx`, `src/renderer/GitDialogs.tsx`; modify `src/shared/menus.ts` (git menus + entries), `src/renderer/FilesTile.tsx`, `src/renderer/App.tsx` (palette), `src/renderer/styles.css`, `src/shared/locales/en.ts`, `test/menus.test.ts`.

**Interfaces:** Consumes Task 1 (`useModule`, `openGit`, `GitParams`) and Task 2 (`window.api.git*`, types, `graph`, `gitView`, `refName`). Produces `export function DiffView(props: { cwd: string; spec: DiffSpec; onClose: () => void })` in `GitPanels.tsx`; in this task it shows a plain unified text of the two sides or a "loading" stub — Task 4 replaces its body.

Port Tessera's `src/renderer/{GitTile,GitPanels,GitDialogs}.tsx` and the git menus (`src/shared/menus.ts` lines 110–198: `commitMenu`, `refMenu`, `dropMenu`, `stashMenu`, `changeMenu`, `fileRefMenu`, `worktreeMenu`) and their tests from Tessera's `test/menus.test.ts`. Changes:
- Remove Claude items/params everywhere; `worktreeMenu` = open in Files tab, remove.
- Worktree double-click and its "open" → `openFolder(containerApi, { path: w.path, host: null }, api.id)`; "Apri shell qui" → `openTerminal(containerApi, { cwd, host: null }, api.id)`; open a file → `openEditor(containerApi, { path, host: null }, api.id)`.
- Settings that Tessera's panels read via `getSettings/useSettings` (collapsed sections, hidden branches…): keep them in the tile's dockview params (`api.updateParameters`) instead of global settings, unless Cassetto already has a fitting place.
- Status `error: 'not-repo'` → `t('Non è un repository git')`; `'no-git'` → `t('Serve git: su macOS installa gli strumenti da riga di comando (xcode-select --install), su Linux il pacchetto git.')`.
- Entry points, only when `useModule('git')` and the tab is local: `filesMenu` gets `git?: boolean` → item `{ id: 'git', label: t('Apri Git qui') }` right after `terminal` for `dir` and `background`; same in `actionsMenu`; FilesTile handles `'git'` with `openGit(containerApi, dir, api.id)`. Palette (App `paletteActions`, group `t('Generali')`): `t('Apri Git qui')` → folder of the active local Files tab, else `window.api.pickFolder()` then `openGit`.
- Keep Tessera's confirmations for reset hard, discard, branch delete, forced worktree removal (texts through `t()`).

- [ ] **Step 1: Failing tests** (menus): `filesMenu({ target: 'background', remote: false, git: true })` has id `git` after `terminal`; with `remote: true` or `git` unset it doesn't; ported git-menu tests minus Claude cases.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test && npx tsc --noEmit -p . && npm run build` → PASS.
- [ ] **Step 5:** Commit `feat: git tile ported from Tessera, opened from Files tabs and the palette`.

---

### Task 4: Side-by-side diffs on CodeMirror merge, README

**Files:** `package.json` (`@codemirror/merge`), `src/renderer/GitPanels.tsx` (`DiffView` body), `src/renderer/styles.css`, `src/shared/locales/en.ts`, `README.md`, `docs/index.html` if it lists features.

- `DiffView`: `window.api.gitDiff(cwd, spec)` → `MergeView` from `@codemirror/merge` with `a` = original, `b` = modified, both read-only (`EditorState.readOnly.of(true)`, `EditorView.editable.of(false)`), language from the file name via `@codemirror/language-data` the way `EditorTile.tsx` does, the same theme handling as `EditorTile` (light/dark follow `useTheme`), `collapseUnchanged: { margin: 3 }`. Loaded lazily (dynamic import) so CodeMirror stays out of the main bundle, as App does for the editor. Esc closes (as in Tessera).
- `DiffTexts` `ok: false` → its error; content containing a NUL byte in the first 8 KB → `t('File binario: nessun diff')`; a side over 5 MB → `t('File troppo grande per il diff')` (no editor created).
- README: a "Compartments" section: what they are, Impostazioni → Scomparti; Git: what the tile does (one short list), local only, needs `git`.

- [ ] **Step 1:** add the dependency (`npm install @codemirror/merge`), implement.
- [ ] **Step 2:** `npm test && npx tsc --noEmit -p . && npm run build` → PASS.
- [ ] **Step 3: Manual checks for the user (report):** enable Git in Impostazioni; "Apri Git qui" on a repo folder shows branches and graph; stage + commit; drag a branch onto another → merge; diff of a modified file side by side, light and dark; a non-repo folder shows the message; turn Git off → entries gone, open Git tab shows the notice; Attiva brings it back.
- [ ] **Step 4:** Commit `feat: side-by-side git diffs; compartments in README`.
