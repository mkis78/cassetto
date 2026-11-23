# Claude Code compartment

Date: 2026-11-23 · Status: approved by the user ("direi che va bene così") on the short design below.

## Intent
Second compartment, so Cassetto can replace Tessera: Tessera's Claude Code features (`~/PROGETTI_PERSONALI/tessera`), ported onto Cassetto's terminal (same node-pty + xterm stack).

## Goals
- Compartment "Claude Code" in Impostazioni → Scomparti, off by default; off = no trace in the UI.
- **One tab per Claude session**: launched with `cswap run <account> -- …` when cswap is present with accounts (per-tab account, the global one never changes), else plain `claude`. Each tab has a session UUID: `--session-id` the first time, `--resume` after a restart; a resume Claude reports as missing falls back to a new session.
- **Live status** from Claude Code hooks passed with `--settings` (never touching `~/.claude/settings.json`), over a local unix socket: working / waiting for you / done. A waiting or done tab is marked (tab dot/highlight); a system notification fires when the window is not focused; clicking it focuses the tab.
- **Account usage** (5h / 7d per account, from `cswap list`) in the top bar.
- **Overview** of every open Claude, the ones waiting first; a click goes there.
- **Worktrees**: a new Claude can start in a new git worktree (new branch in a folder next to the repository). The Git tile's worktree double-click opens a Claude there when the compartment is on.
- **Both ways**: Cmd+click a path printed in a terminal (`src/app.ts:42`) opens it in the editor at that line (all terminals, a base feature); "Invia a Claude" from the editor (selected lines), the Git tile, the Files tab and search results types the reference at the last-used Claude's prompt (only with the compartment on and a Claude tab open).
- Entry points: palette "Nuovo Claude…" and "Apri Claude qui" in local Files tabs (menu + action bar).

## Non-goals
Claude on SSH hosts; installing `claude`/`cswap` for the user (a missing tool gets a clear message with how to install); Tessera's workspaces, notes, monitor tile, tools dialog.

## Anti-goals
Touching the user's Claude config; a hook that can block or break Claude (timeout, `|| true`); losing a conversation on resume failures other than "No conversation found".

## Approach (only sensible one)
Port as for Git: main-side launch/hooks/socket/cswap, renderer tab + state store + dialogs, gated by `moduleOn('claude')`. A lighter "open Claude here" was rejected: it would not replace Tessera.

## Left to the builder
File split, names, socket path/cleanup details, tests (ported Tessera tests + gating).
