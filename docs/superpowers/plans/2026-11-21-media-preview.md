# PDF, Video and Audio Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Space and the gallery preview local PDFs (pdf.js), videos and audio; on SSH hosts they show a notice.

**Architecture:** Main serves previewed files over a new `preview://` scheme. Each URL is an unguessable token mapped to one path, with HTTP Range support. `files:preview` returns `{ kind: 'pdf' | 'video' | 'audio', src }` for these types. The renderer shows `<video>`/`<audio>`, or a lazily-loaded pdf.js page list.

**Tech Stack:** Electron 45 `protocol.handle`, Node streams, React, `pdfjs-dist`, vitest.

**Spec:** `docs/superpowers/specs/2026-11-21-media-preview-design.md`

## Global Constraints

- Local files only; SSH shows "Anteprima di PDF, video e audio non disponibile sui server".
- Never serve a path that was not handed out by `files:preview`; no `file://`, no `webPreferences.plugins`.
- CSP widens only by `media-src preview:` and `connect-src 'self' preview:`.
- Every new Italian string gets its English in `src/shared/locales/en.ts` (`test/i18n.test.ts` enforces it).
- No PDF zoom, search or page bar.

## Review Focus

- A file renamed, deleted or truncated after it was previewed: the channel answers 404 or 416, it never crashes main → Task 1 test `serve: missing file is 404`.
- `Range: bytes=500-` (open-ended) and `bytes=-500` (suffix) are what `<video>` and pdf.js actually send → Task 1 `parseRange` tests.
- Switching quickly between files while a video plays: the old element must stop. React must remount on a new `src`, so key the element by `src` → Task 3.
- A corrupt or password-protected PDF shows an error line, not an endless "Caricamento…" → Task 4.
- An unplayable codec (e.g. `.mkv` with HEVC) shows "Formato non supportato" → Task 3.

---

### Task 1: The `preview://` channel (pure main module)

**Files:**
- Create: `src/main/mediaPreview.ts`
- Test: `test/mediaPreview.test.ts`

**Interfaces:**
- Produces:
  - `MEDIA: Record<string, { kind: 'pdf' | 'video' | 'audio'; mime: string }>`, keyed by lowercase extension: pdf; mp4, m4v, mov, webm, ogv, mkv (video); mp3, m4a, aac, wav, flac, ogg, opus, oga (audio).
  - `mediaOf(name: string): { kind: 'pdf' | 'video' | 'audio'; mime: string } | undefined`, by extension, like `imageType` in `src/shared/format.ts`.
  - `class MediaTokens { add(path: string): string /* the preview:// URL */; path(url: string): string | null }`. It keeps the last 16 tokens (`randomUUID()`) and evicts the oldest: several panels may preview at once. URL form: `preview://media/<token>`.
  - `parseRange(header: string | null, size: number): { start: number; end: number } | 'invalid' | null`. `null` means no header (send the whole file). `end` is inclusive.
  - `serveMedia(tokens: MediaTokens, req: Request): Promise<Response>`.

- [ ] **Step 1: Write the failing tests** in `test/mediaPreview.test.ts`:
  - `mediaOf`: `'a.PDF'` → pdf / `application/pdf`; `'b.mp4'` → video; `'c.flac'` → audio; `'d.txt'` and `'noext'` → undefined.
  - `tokens`: `add('/x/a.pdf')` returns a URL that starts with `preview://media/`, and `path(thatUrl)` returns `'/x/a.pdf'`. `path('preview://media/nope')`, `path('preview://other/<same token>')` and `path('file:///etc/passwd')` → null. After 17 `add` calls the first URL → null.
  - `parseRange`: `(null, 1000)` → null; `('bytes=0-99', 1000)` → `{0,99}`; `('bytes=500-', 1000)` → `{500,999}`; `('bytes=-100', 1000)` → `{900,999}`; `('bytes=0-5000', 1000)` → `{0,999}`; `('bytes=1000-', 1000)`, `('bytes=5-2', 1000)`, `('bytes=0-1,5-6', 1000)` and `('items=0-1', 1000)` → `'invalid'`.
  - `serve`: with a temp file of 1000 bytes and a token: without Range → 200, `Content-Length: 1000`, `Accept-Ranges: bytes`, the right `Content-Type`, body of 1000 bytes. With `Range: bytes=10-19` → 206, `Content-Range: bytes 10-19/1000`, body equal to bytes 10..19. With `bytes=2000-` → 416 and `Content-Range: bytes */1000`. Unknown token → 404.
  - `serve: missing file is 404`: token added, then the file is deleted → 404.

- [ ] **Step 2: Run** `npx vitest run test/mediaPreview.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `src/main/mediaPreview.ts`.** Use `stat` for the size (a failure means 404), and `Readable.toWeb(createReadStream(path, { start, end }))` as the body. Every response carries `Access-Control-Allow-Origin: *` and `Access-Control-Expose-Headers: Content-Range, Content-Length, Accept-Ranges`: the page is `app://cassetto` (or `http://localhost` in dev) and pdf.js fetches cross-origin. The token is the secret. Mark the cap: `// shortcut: last 16 previews only, a panel left open longer re-asks via files:preview`.

- [ ] **Step 4: Run** `npx vitest run test/mediaPreview.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit** `feat: preview:// channel serving one previewed file with Range`.

### Task 2: Wire it into `files:preview`, the scheme and the CSP

**Files:**
- Modify: `src/shared/types.ts:96` (`Preview`)
- Modify: `src/main/files.ts` (`previewLocal`)
- Modify: `src/main/ssh.ts:149` (`previewRemote`)
- Modify: `src/main/index.ts:45` (scheme registration), `:469` area (handler)
- Modify: `src/renderer/index.html:5` (CSP)
- Modify: `src/shared/locales/en.ts`
- Test: `test/files.test.ts`

**Interfaces:**
- Consumes: `mediaOf`, `MediaTokens`, `serveMedia` from Task 1.
- Produces: `Preview` gains `| { kind: 'pdf' | 'video' | 'audio'; src: string }`. Also `previewLocal(path: string, tokens: MediaTokens): Promise<Preview>`, which returns `{ kind, src: tokens.add(path) }` for media without reading any bytes, but only after `stat` shows a regular file (a missing file is still `{ kind: 'error' }`).

- [ ] **Step 1: Add to `test/files.test.ts`:** `previewLocal(join(dir,'a.pdf'), tokens)` on an existing file → `kind: 'pdf'`, and `tokens.path(src)` is that path. `previewLocal` on a missing `x.mp4` → `kind: 'error'`. Update the existing `previewLocal` calls to pass a `new MediaTokens()`.
- [ ] **Step 2: Run** `npx vitest run test/files.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `previewLocal` takes `tokens`. `previewRemote` returns `{ kind: 'error', error: t('Anteprima di PDF, video e audio non disponibile sui server') }` when `mediaOf(path)` matches, before running `ssh`. In `index.ts`: create one `const media = new MediaTokens()`, pass it in the `files:preview` handler, add `{ scheme: 'preview', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }` to the existing `registerSchemesAsPrivileged` array, and `protocol.handle('preview', req => serveMedia(media, req))` next to the `app` handler. In the CSP, add `media-src preview:; connect-src 'self' preview:`. Add the new string to `en.ts`: "PDF, video and audio previews aren't available on servers".
- [ ] **Step 4: Run** `npm test`. Expected: all PASS (`i18n.test.ts` included).
- [ ] **Step 5: Commit** `feat: files:preview returns PDF, video and audio via preview://`.

### Task 3: Video and audio in `FilePreview`

**Files:**
- Modify: `src/renderer/FilesTile.tsx:902-930` (`FilePreview`)
- Modify: `src/renderer/styles.css` (next to `.files-preview > img`, lines 234 and 415)
- Modify: `src/shared/locales/en.ts`

**Interfaces:**
- Consumes: the `Preview` kinds from Task 2.

- [ ] **Step 1: Implement.** Add a `MediaPreview({ kind, src })` component in `FilesTile.tsx`: `<video controls src>` or `<audio controls src>`, with `key={src}` so switching files tears the old one down. `onError` sets local state and shows `<div className="files-empty">{t('Formato non supportato')}</div>`. CSS: video `max-width: calc(100% - 20px); margin: 10px`, and in the gallery the same `max-height` rule as the img. Audio is full width with a 10px margin. English: "Unsupported format".
- [ ] **Step 2: Verify by hand** (no renderer test harness in this repo). Run `npm run dev`, open a folder with an `.mp4`, a `.mp3` and a `.mkv`, and press Space. The video plays and seeking past the middle works (in DevTools → Network, the requests are 206). The mp3 plays. A file Chromium can't play shows "Formato non supportato". Switching file stops playback.
- [ ] **Step 3: Run** `npm test && npx tsc --noEmit -p .`. Expected: PASS.
- [ ] **Step 4: Commit** `feat: video and audio preview`.

### Task 4: PDF preview with pdf.js

**Files:**
- Create: `src/renderer/PdfPreview.tsx`
- Modify: `src/renderer/FilesTile.tsx` (`FilePreview`: `React.lazy` import, like `Editor` in `App.tsx:27`)
- Modify: `src/renderer/styles.css`, `src/shared/locales/en.ts`, `package.json` (`pdfjs-dist`, the current major)

**Interfaces:**
- Produces: `export default function PdfPreview({ src }: { src: string })`.

- [ ] **Step 1: Install** `npm i pdfjs-dist`.
- [ ] **Step 2: Implement `PdfPreview`.** Load the worker with `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'` and set `GlobalWorkerOptions.workerSrc = workerUrl`. Call `getDocument({ url: src, isEvalSupported: false, disableAutoFetch: true })`, so with Range only the pages in view are read. Show one `<canvas>` per page, rendered at the panel width × `devicePixelRatio` when an `IntersectionObserver` sees it (placeholders sized from page 1's aspect ratio). On unmount or a new `src`, call `loadingTask.destroy()`. A load error shows `<pre className="files-preview-error">{t('PDF non leggibile: {error}', { error })}</pre>`, which covers both corrupt and password-protected files. In `FilePreview`, wrap it in `<Suspense fallback={Caricamento…}>`. English: "Unreadable PDF: {error}".
- [ ] **Step 3: Verify the build** with `npm run build`. Expected: success, and `out/renderer/assets/` holds a separate `pdf.worker.min-*.mjs` and a `PdfPreview-*.js` chunk (pdf.js stays out of the main bundle).
- [ ] **Step 4: Verify by hand** with `npm run dev`: a multi-page PDF in the side preview and in the gallery. Pages appear while scrolling; there are no CSP errors in the console; a renamed `.txt → .pdf` shows the error line; a 100 MB+ PDF opens without loading it all (in Network, 206 requests).
- [ ] **Step 5: Run** `npm test && npx tsc --noEmit -p .`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: PDF preview with pdf.js`.

### Task 5: Docs

**Files:**
- Modify: `README.md:67`

- [ ] **Step 1:** Change the line to "**Preview** text, Markdown, images, PDFs, video and audio with the space bar (PDF, video and audio on this Mac only, not on SSH servers)." Use "this computer" in place of "this Mac" if the surrounding text is OS-neutral.
- [ ] **Step 2: Commit** `docs: media preview in README`.
