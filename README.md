<p align="center">
  <img src="build/icon.png" width="128" alt="Cassetto icon">
</p>

<h1 align="center">Cassetto</h1>

<p align="center"><b>Un file manager per macOS, alternativo a Finder.</b></p>

## Cosa fa già

- **Tab e pannelli**: Cmd+T nuovo tab, trascina un tab sul bordo di un altro per affiancarli (doppio pannello), Cmd+] / Cmd+[ per passare dall'uno all'altro. Layout e cartelle tornano al riavvio.
- **Quattro viste**: elenco (ordinabile per nome, dimensione, data), icone, colonne, galleria con miniature.
- **Nuovo file vuoto** e nuova cartella, dalla barra o dal menu contestuale.
- Rinomina (F2), duplica, copia/taglia/incolla (Cmd+C/X/V), trascina per spostare (Alt per copiare), Cestino, conflitti di nome gestiti.
- **Anteprima** (spazio) di testo, markdown e immagini.
- **Ricerca** per nome (`*.ts`, `src/**/*.tsx`) o contenuto sotto la cartella aperta.
- **Vai a file** (Cmd+P) e **comandi** (Cmd+Shift+P).
- **Server SSH** (Cmd+K): sfoglia, copia, sposta ed elimina file remoti con gli host di `~/.ssh/config`.
- **Terminale** (Cmd+Alt+T, o «Apri terminale qui» dal menu): una shell in un tab, nella cartella scelta; su un server SSH si apre lì.

## Sviluppo

Node.js LTS.

```sh
npm install
npm run dev      # hot reload; main e preload si ricompilano e l'app si riavvia
npm test         # vitest
npm run dist     # dist/Cassetto-<version>-arm64.dmg
```

```
src/main/      processo principale: elenco, anteprima, operazioni sui file, ricerca, ssh, stato
src/preload/   ponte IPC
src/renderer/  React: tab dockview, FilesTile, ricerca, palette, dialoghi
src/shared/    logica pura: tipi, menu, ordinamento, navigazione liste, formati
test/          Vitest
```

## Credits

Ideato da Marco Pennisi e costruito con [Claude](https://claude.com/claude-code). Basato su [Electron](https://www.electronjs.org/), [React](https://react.dev/), [dockview](https://dockview.dev/), [Lucide](https://lucide.dev/).
