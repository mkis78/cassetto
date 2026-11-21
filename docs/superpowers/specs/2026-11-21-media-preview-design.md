# PDF, Video and Audio Preview

Date: 2026-11-21 · Status: approved

## Intent

Part of Base B. Space (and the gallery) already preview text, Markdown and images; PDFs, videos and audio show "binary". Someone arriving from Finder expects Quick Look to show them. This closes that gap for local files.

## Goals

- Preview PDFs, videos and audio in the side preview and in the gallery, for local files (archive members included: they are extracted locally).
- On an SSH host, a clear notice instead of a preview.

## Non-goals

- Previews on SSH servers (decided: downloading gigabytes just to look is not worth it).
- PDF zoom, search, page bar: it is a preview; Open With covers the rest.
- PDF thumbnails in the gallery strip.

## Anti-goals

- Reopening `file://` to the renderer, or any channel that can read more than the one file being previewed.
- Turning on Chromium plugins (`webPreferences.plugins`).

## Approaches

- A. `preview://` channel + Chromium's built-in PDF viewer. Least code, but needs `plugins: true` and the viewer's look is Chromium's.
- **B. `preview://` channel + pdf.js (chosen by Marco).** PDFs drawn on canvas with the app's look, no plugins. Costs a dependency (`pdfjs-dist`) and a small hand-made page list.
- Rejected: serving media via `file://` (closed on purpose, see `src/main/appProtocol.ts`).

## Design

- **`preview://` scheme (main).** Registered privileged (`standard`, `secure`, `supportFetchAPI`, `stream`). Each `files:preview` call for a PDF/video/audio hands out an unguessable token URL mapped to that one path; main keeps the last 16 (split panels preview at once — builder's call); any other URL gets 404. Handles `Range` with `createReadStream` (206 with `Content-Range`, 416 when out of bounds), so video seeking and pdf.js range loading read only what they need.
- **`Preview` type.** Adds `{ kind: 'pdf' | 'video' | 'audio'; src: string }`, chosen by extension the way `imageType` does. `previewRemote` returns a `{ kind: 'error' }`-style notice for these extensions: "Anteprima di PDF, video e audio non disponibile sui server".
- **Video / audio.** `<video controls>` / `<audio controls>` on the channel. A media `error` event shows "Formato non supportato" instead of a black box.
- **PDF.** `pdfjs-dist`, worker loaded from `'self'`. Pages in a column, fit to panel width, each rendered when it scrolls into view. Same component for side preview and gallery.
- **CSP.** Add `media-src preview:` and `connect-src preview:` (pdf.js fetches); nothing else widens.
- **Tests.** The pure parts: which URL the channel serves, and Range parsing (start, end, open-ended, out of bounds).

## Left to the builder

- Exact extension lists (what Chromium plays: mp4, webm, mov, m4v, ogg; mp3, m4a, wav, flac, ogg/opus).
- `pdfjs-dist` version and how electron-vite bundles its worker.
- Labels and strings, added to the locales like the others.
