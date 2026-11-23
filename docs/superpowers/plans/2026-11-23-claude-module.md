# Claude Code Compartment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port Tessera's Claude Code features into a Cassetto compartment.

**Architecture:** Main builds the Claude launch (cswap/claude, session id, hooks via `--settings`) on the existing `PtyManager`, runs a unix-socket server receiving hook calls and forwards them to the renderer; the renderer has a `claude` tab kind on the existing terminal code, a state store, dialogs, top-bar usage and an overview; everything gated by `moduleOn('claude')`.

**Tech Stack:** Electron 45 (main `Notification`), node-pty, xterm, React 19, dockview, vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-claude-module-design.md`

## Global Constraints

- Port from Tessera (`/Users/marcopennisi/PROGETTI_PERSONALI/tessera`, read only): `src/main/{launch,events,cswap}.ts`, `src/shared/claudeState.ts`, `src/shared/termLinks.ts`, `src/renderer/{claudeStore.ts,terminals.ts,ClaudeTab.tsx,NewClaudeDialog.tsx,AccountsBar.tsx,ClaudeOverview.tsx,tiles.ts}` and their tests. Adapt to Cassetto's code; don't copy what Cassetto already has (e.g. `childEnv`/`ptyEnv` in `src/main/terminal.ts`).
- macOS + Linux; processes via argv (no shell) except the hook command string Claude itself runs; nothing touches `~/.claude/settings.json`.
- Compartment `claude` off by default; off = no menu entry, palette command, top-bar item or "Invia a Claude". Claude is local only: no Claude entry on SSH tabs.
- Every UI string through `t()`/`tx()` with Italian keys, English in `src/shared/locales/en.ts`; menus as data in `src/shared/menus.ts`; styles with Cassetto's CSS variables (both themes); icons from `lucide-react` with `ICON`.
- English commit messages, NO Co-Authored-By / Claude trailers.

## Review Focus

- `claude` / `cswap` not installed → the tab shows how to install them (no silent dead tab) (Task 2).
- App restart → each Claude tab resumes its own conversation; one closed before its first message starts fresh, any other failure keeps the session id (Task 1 tests of the fallback rule; Task 2 wiring).
- Two Cassetto instances or a crashed run → the hook socket path is per process and stale sockets are removed (Task 1 test on `staleSockets`).
- Hook arriving for a tab already closed → ignored, never resurrects state (Task 2 store test, ported).
- Compartment off while Claude tabs are open in a saved layout → the tab shows the disabled notice and no `claude` process starts (Task 2).

---

### Task 1: Claude in main

**Files:** Create `src/main/claude.ts` (launch + hooks + fallback rule + cswap choice), `src/main/claudeEvents.ts` (socket server, stale sockets), `src/main/cswap.ts`; modify `src/main/index.ts`, `src/main/git.ts` (restore `gitWorktreeAdd` from Tessera + `git:worktreeAdd`), `src/preload/index.ts`, `src/shared/types.ts`, `src/renderer/modules.ts`; tests `test/claude.test.ts`, `test/cswap.test.ts`, `test/claudeEvents.test.ts`, `test/git.test.ts` (worktreeAdd, ported).

**Interfaces (produces):**
- `export type ClaudeParams = { kind: 'claude'; cwd: string; sessionId: string; started: boolean; account?: string; name?: string; color?: TabColor }`, added to `TileParams`. `export type ClaudeEvent = 'prompt' | 'tool' | 'permission' | 'stop'`. `export interface Account { slot: number; email: string; label: string; active: boolean; usage5h: number | null; usage7d: number | null }`.
- `MODULES` gains `{ id: 'claude', name: tx('Claude Code'), description: tx('Sessioni di Claude Code in un tab, con stato, account e worktree') }`; `ModuleId = 'git' | 'claude'`.
- `claudeLaunch(p: ClaudeParams, ctx: { sock: string; tileId: string; cswap: boolean }): Launch` (Launch from `src/main/terminal.ts`, extended with `env?: Record<string,string>` merged over `ptyEnv`; env `CASSETTO_TILE`, `CASSETTO_SOCK`); `hookSettings()`, `shouldFallbackToNewSession(p, exitCode, output)`, `useCswap(onPathCswap, list)` as in Tessera's launch.ts.
- `startEventServer(sock, onEvent)`, `staleSockets(files, isAlive)` (pattern `cassetto-<pid>.sock` in `os.tmpdir()`), `pidAlive` — as Tessera's events.ts.
- `parseCswapList`, `listAccounts()` as Tessera's cswap.ts (error string through `t()`).
- IPC: `pty:create` accepts `ClaudeParams` too (kind `claude` → `claudeLaunch`); preload `claudeAccounts(): Promise<{ accounts: Account[]; error: string | null }>` (`claude:accounts`), `onClaudeEvent(cb: (tileId: string, e: ClaudeEvent) => void): () => void` (main sends `claude:event`), `claudeTools(): Promise<{ claude: boolean; cswap: boolean }>` (on PATH, same PATH lookup the terminal uses), `notify(title: string, body: string, tileId: string): void` (main `Notification`; click → focus window + send `claude:reveal` with tileId), `onClaudeReveal(cb)`, `gitWorktreeAdd(cwd, branch)`.
- The event server starts lazily on the first Claude `pty:create` and is closed on quit (socket file removed); stale sockets removed at start.

- [ ] **Step 1:** Port Tessera's tests for launch (claude parts only), events, cswap and worktreeAdd, adapted to the names above; add: env carries `CASSETTO_TILE`/`CASSETTO_SOCK`; `hookSettings()` command never writes outside `curl … || true` with `-m 2`.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test && npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5:** Commit `feat: claude sessions, hooks and accounts in main`.

---

### Task 2: Claude tab, state, new-Claude dialog, notifications

**Files:** Create `src/shared/claudeState.ts` (+ `test/claudeState.test.ts`, ported), `src/renderer/claudeStore.ts`, `src/renderer/NewClaudeDialog.tsx`; modify `src/renderer/terminals.ts`, `src/renderer/TerminalTile.tsx`, `src/renderer/Tab.tsx`, `src/renderer/tiles.ts`, `src/renderer/App.tsx`, `src/shared/menus.ts`, `src/renderer/FilesTile.tsx`, `src/renderer/styles.css`, `src/shared/locales/en.ts`, `test/menus.test.ts`.

**Interfaces:** Consumes Task 1. Produces `openClaude(api, where: { cwd: string; account?: string; name?: string }, nextTo?: string): void` and `lastClaudeTile(): string | null` in `tiles.ts`; `claudeStore` exports `useClaudeState(id): ClaudeState`, `claudeStates(): Map<string, ClaudeState>`, `subscribe`.

- Component `claude` = the terminal tile with Claude params (reuse `TerminalTile`/`attachTerminal`; port Tessera's claude-specific parts of `terminals.ts`: keystrokes → `input`/`interrupt` events, exit → `exit`, `started` set in params after the first prompt, resume fallback via `shouldFallbackToNewSession` → new `sessionId`, `started: false`, relaunch).
- Compartment off → the tab shows `t('Lo scomparto Claude Code è disattivato')` + `t('Attiva')` (as GitTile) and spawns nothing.
- `claude` (and `cswap` when accounts are expected) missing → the tab shows `t('Claude Code non trovato: installalo con «curl -fsSL https://claude.ai/install.sh | bash» e riapri il tab.')`.
- Tab (Tab.tsx): state dot for waiting/done (Tessera's ClaudeTab look); the store's `focus` event when the tab is active and the window focused.
- Notifications: on transition to `waiting` or `done` while `!document.hasFocus()` → `window.api.notify(title, t('Claude aspetta te') | t('Claude ha finito'), id)`; `onClaudeReveal` activates and focuses that tab.
- NewClaudeDialog (port): folder, account (when cswap has accounts), name, "Nuovo worktree" with branch name (validated with `isValidRefName`) → `gitWorktreeAdd` then open in that path.
- Entry points (only with the compartment on, local tabs): palette `t('Nuovo Claude…')` (dialog with the active local folder), `filesMenu`/`actionsMenu` gain `claude?: boolean` → `{ id: 'claude', label: t('Apri Claude qui') }` right after `git` (or `terminal` when git is absent) for `dir` and `background`; GitTile worktree double-click → `openClaude` when the compartment is on, else the Files tab as today.

- [ ] **Step 1: Failing tests:** ported claudeState tests (incl. closed tab ignores late hooks); menus: `filesMenu({ target: 'background', remote: false, claude: true })` has `claude`; not with `remote: true`; order after `git` when both.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test && npx tsc --noEmit -p . && npm run build` → PASS.
- [ ] **Step 5:** Commit `feat: claude tabs with live status, notifications and the new-Claude dialog`.

---

### Task 3: Account usage and overview

**Files:** Create `src/renderer/AccountsBar.tsx`, `src/renderer/ClaudeOverview.tsx` (port); modify `src/renderer/App.tsx`, `src/renderer/styles.css`, `src/shared/locales/en.ts`.

- AccountsBar in the top bar, only with the compartment on and `claudeAccounts()` returning accounts: per account label + 5h / 7d %, refreshed every 5 minutes and on window focus (Tessera's cadence if different — keep Tessera's).
- ClaudeOverview: a top-bar button (only when at least one Claude tab exists) listing every Claude tab with name, folder, state; waiting first, then done, working, idle; click activates the tab. Palette `t('Panoramica dei Claude')`.

- [ ] **Step 1:** implement (pure ordering function in `src/shared/claudeState.ts`, `overviewOrder(items)`, with a test).
- [ ] **Step 2:** `npm test && npx tsc --noEmit -p . && npm run build` → PASS.
- [ ] **Step 3:** Commit `feat: claude account usage and overview`.

---

### Task 4: Paths both ways, README

**Files:** Create `src/shared/termLinks.ts` (+ `test/termLinks.test.ts`, ported); modify `src/renderer/terminals.ts` (link provider, all terminals), `src/renderer/tiles.ts` (`sendToClaude`, `claudeTarget`; `openEditor` gains `line?: number`), `src/renderer/EditorTile.tsx` (go to `line` on open; "Invia a Claude" with selected lines), `src/renderer/GitTile.tsx` + `src/shared/menus.ts` (git file menus' `claude` item), `src/renderer/FilesTile.tsx`, `src/renderer/FileSearch.tsx`, `src/shared/locales/en.ts`, `README.md`, `test/menus.test.ts`.

- Cmd+click (Ctrl+click on Linux) on a path in any terminal (`src/a.ts:42`, `./b.md`, absolute) resolved against the terminal's cwd → `openEditor` at that line; on an SSH terminal the path opens on that host. Only existing files (check with `window.api.stat` or the existing equivalent).
- "Invia a Claude" (`id: 'claude'`): Files tab item menu, Git change/commit-file menus, search results, editor (selection → `path:from-to`); present only when the compartment is on and `claudeTarget(api)` is not null; writes the path (relative to the Claude's cwd when inside it) at the prompt and focuses that tab, as Tessera's `sendToClaude`.
- README: "Claude Code" compartment section (what it does, needs `claude`, optional `cswap`).

- [ ] **Step 1: Failing tests:** ported termLinks tests; menus with/without `claude` item.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test && npx tsc --noEmit -p . && npm run build` → PASS.
- [ ] **Step 5: Manual checks for the user (report):** enable Claude Code; "Apri Claude qui" opens a session; restart the app → the conversation resumes; ask something needing permission with the window in background → notification, click → the tab; tab dot on waiting/done; usage in the top bar with cswap; overview; new Claude in a worktree → its branch appears in Git; Cmd+click `src/x.ts:10` in a terminal → editor at line 10; "Invia a Claude" from Files and the editor.
- [ ] **Step 6:** Commit `feat: terminal paths open in the editor; send files and lines to Claude`.
