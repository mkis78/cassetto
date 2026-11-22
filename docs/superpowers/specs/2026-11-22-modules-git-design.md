# Compartments (modules) + Git

Date: 2026-11-22 · Status: the user handed the decisions over ("vai avanti tu"); every choice below is the builder's call, stated so it can be corrected.

## Intent
Cassetto is a clean file manager with opt-in "compartments" on top. It is meant to replace Tessera, whose most-used compartment is a GitKraken-style Git tile. This work adds the smallest compartment infrastructure and the first compartment: Git, ported from Tessera (`~/PROGETTI_PERSONALI/tessera`).

## Goals
- **Compartments**: built-in features you switch on or off in Impostazioni → "Scomparti", one checkbox each with a one-line description. Off = no trace in the UI (no menu entries, no new-tab item, no palette command).
- **Git compartment, off by default** (a plain file manager user never sees it). Once on:
  - a `git` tab kind showing Tessera's Git tile: branches / remotes / tags / stashes / worktrees on the left, the commit graph in the middle, the selected commit or the working tree on the right;
  - stage, unstage, discard, commit, amend; merge/rebase by dragging a branch, push by dropping on a remote; checkout, branch, tag, cherry-pick, revert, reset, rename, delete; fetch / pull / push / stash / pop; conflicts with Continue / Abort; commit search, solo/hide branches;
  - side-by-side diffs, read-only;
  - opened with "Apri Git qui" in a local Files tab (menu + action bar), "Git" in the new-tab menu and in the palette (the folder of the active local Files tab, else a folder picker).

## Non-goals
- Third-party / downloadable compartments, a plugin API, per-compartment processes. A compartment is code shipped in the app plus a setting.
- Git on SSH hosts (Tessera is local-only too); "Apri Git qui" is hidden on remote tabs.
- Claude integration from Tessera's tile ("Invia a Claude", Claude in a worktree) — that comes with the Claude Code compartment.
- Creating worktrees (Tessera did it for Claude); the tile lists worktrees, opens one in a Files tab, removes one.
- Installing git for the user. Missing git: the Git tile says so ("Serve git: …" with how to get it per OS).

## Anti-goals
- Any core file-manager behaviour depending on a compartment.
- A saved layout with a Git tab breaking when Git is switched off: the tab shows "Lo scomparto Git è disattivato" with an "Attiva" button.
- Git operations that silently destroy work: hard reset, discard and forced worktree removal keep Tessera's confirmations.

## Constraints
- macOS + Linux; the `git` CLI via `spawn` argv (no shell), as Tessera does. Cross-platform rule from Base A holds.
- UI strings through `t()` with Italian keys, English in `src/shared/locales/en.ts` (Tessera's strings are raw Italian: wrap them). Menus as data in `src/shared/menus.ts`. Styles with Cassetto's CSS variables (light + dark themes).
- Cassetto's editor is CodeMirror, Tessera's diff used Monaco: the diff view is rebuilt on `@codemirror/merge` (new dependency, the official CodeMirror package) — not Monaco.

## Approaches
- **Chosen: setting-gated built-in compartments.** `Settings.modules` + a tiny registry in the renderer; main always registers the git IPC (harmless when unused). Smallest thing that delivers "off = invisible" and leaves room for Claude Code and PowerToys compartments the same way.
- Rejected: a plugin system (manifests, loading code at runtime): nobody asked for third-party compartments, large surface, security work.
- Rejected: separate builds per compartment: more release work for no user benefit.

## Design
- `Settings.modules?: { git?: boolean }`; `moduleOn(id)` in `src/renderer/settings.ts`.
- `src/renderer/modules.ts`: the list of compartments (`id`, name, description) shown in Settings. The dockview `components` map always includes `git` so restored layouts render; `GitTile` shows the disabled notice when off.
- Main: port `src/main/git.ts` (+ `src/shared/{graph,gitView,refName}.ts`, git types) and its tests; `git:*` handlers and preload API as in Tessera, minus `git:worktreeAdd`.
- Renderer: port `GitTile.tsx`, `GitPanels.tsx`, `GitDialogs.tsx` and the git menus; drop the Claude bits; worktree double-click → Files tab in that folder; "Apri shell qui" → Cassetto terminal tab; file "Apri" → Cassetto editor tab; diff view on `@codemirror/merge`.

## Left to the builder
File split, exact names, CSS, how the tile detects "not a repository" / missing git, tests (ported Tessera tests + settings gating).
