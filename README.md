# GMing Tool

A small Game Master's desk for tabletop sessions: a shelf of reference
documents you read in place, a search across all of them, and a music library
that plays YouTube tracks.

It is a local web app. `./start.sh` builds it, serves it on
`http://127.0.0.1:4173/`, and opens your browser. There is no account and no
telemetry. The only server is the one the launcher starts, on your machine: it
hands your browser the documents from a folder on disk and, for Word and
OpenDocument files, converts them to PDF with LibreOffice first. Nothing is
uploaded anywhere.

## Music, and staying ad-free

Tracks play through **YouTube's own embedded player** (the official IFrame Player
API). Nothing is downloaded, extracted, or re-streamed: the app hands a video id
to YouTube and YouTube plays it. That is the same mechanism any website uses to
embed a video, so it stays within YouTube's terms.

Ad-free playback comes from **your own** YouTube Premium session, which reaches
the embedded player by third-party cookie. That works in **Chrome or Edge**, as
long as you are signed in to YouTube there. Browsers that partition third-party
cookies — Firefox with Total Cookie Protection, Safari — hide your account from
the embedded player, so ads will appear even with Premium. **Open the app in
Chrome or Edge to keep it ad-free.**

> Earlier versions of this tool resolved and streamed the audio directly with
> `yt-dlp`, which is against YouTube's Terms of Service. That approach is gone.

## Requirements

- **Node.js 20 or newer** — used to build and serve the app.
- **A browser.** Chrome or Edge recommended (see above).
- **LibreOffice** — only if you want to read Word (`.docx`) or OpenDocument
  (`.odt`) files. PDFs need nothing else. Without it, PDFs still open normally
  and office documents show a note explaining what is missing.

Nothing else: no `yt-dlp`, no media libraries, no system codecs.

## Running it

| Command | What it does |
| --- | --- |
| `./start.sh` | Build, serve on `http://127.0.0.1:4173/`, open the browser. |
| `PORT=8080 ./start.sh` | Same, on a different port. |
| `DOC_DIR=~/rpg-books ./start.sh` | Same, reading reference documents from another folder. |
| `start.cmd` | Same as `start.sh`, for Windows. |
| `./dev.sh` | Vite dev server with hot reload on port 5173. |

`start.sh` works on Linux and macOS, and on Windows from Git Bash (it will not
auto-open the browser there — just visit the printed URL).

## Your work is saved

- The music library lives in the browser's local storage and is written about a
  second after you stop editing. The status bar tells you when it is saved.
- Browser storage does not travel between machines, so use **Export** and
  **Import** in the header to carry a music library between, say, Linux and
  Windows as a `.json` file.
- That file still carries a `schema_version`. Older saves — including ones the
  original Rust build wrote, with a `story` section — import unchanged; the old
  chapters are simply ignored, since story text is now a document on the shelf.
- If stored data is ever unreadable, a copy is kept aside and a fresh library is
  started rather than destroying anything.
- The app also remembers which page of each document you were reading. That is a
  browser-local setting, kept out of the exported `.json`.

## What it does

**Documents** — put PDFs, Word and OpenDocument files in `pdfs/` next to the
project (see below) and they appear in the list on the left. Click one and it
opens in your browser's own PDF viewer; a `.docx` or `.odt` is converted to PDF
first and then shown the same way, so its pages, zoom and the viewer's own
`⌘/Ctrl-F` all work as usual. The search box finds a phrase across **every**
document at once.

**Music** — paste a YouTube link (watch, `youtu.be`, `embed`, `shorts` or `live`
URLs, or a bare video id), click a track to play it, and use play/pause, stop and
the volume slider. Tracks can be removed. Titles are fetched from YouTube's
public oEmbed endpoint, falling back to whatever the player reports.

Switching tracks **crossfades**. A second player starts the new video silently —
waiting until it is actually playing so there is no gap — and the two are then
blended, sound and picture together, over about a second and a half. Play, pause
and stop act on the current track as before; only a change of track blends.

## Reference documents

The documents folder sits next to the project. The launcher creates it on first
run; put your books in it and they appear in the list:

```
pdfs/
  rulebook.pdf
  session-notes.docx
  handouts/Player Handout.odt   folders are fine, and are searched too
```

- **Formats** — `.pdf` files are served as they are. `.docx` and `.odt` files are
  converted to PDF by LibreOffice when you first open them, and the result is
  cached, so the second look is instant. Converting takes a moment on a long
  document; the pane says so while it works.
- **Reading** — click a document and it opens in your browser's own PDF viewer,
  so its built-in search, page box and zoom all work as usual.
- **Searching** — the box at the top searches **every** document at once — the
  extracted text of each book is read once (pdf.js, a page at a time, with
  progress shown), then cached in the browser and reused. For a Word or
  OpenDocument file, the text is read from its converted PDF, so those are
  searchable too. Hits list the document and page with a snippet, the match
  highlighted; clicking one jumps the viewer to that page. Results are capped, so
  a word that appears on every page cannot flood the panel.
- **⌘/Ctrl-F inside the viewer** searches only the document you are reading. The
  box is for finding which book a rule is in.
- **Scanned PDFs** have no text layer, so search cannot see inside them. The
  panel names those documents instead of quietly finding nothing; they still
  display normally.
- **`DOC_DIR`** — to keep documents elsewhere, `DOC_DIR=~/rpg-books ./start.sh`.
  (`PDF_DIR` is still accepted for older setups.)

The folder is served by the same local server as the app, on `127.0.0.1` only,
with byte-range requests, so a 300 MB rulebook streams and seeks rather than
being copied into the browser first. Nothing is uploaded anywhere: the server
reads that one folder, hands out documents from inside it (paths that try to
climb out are refused), and for office files runs LibreOffice locally to make a
PDF. Conversions are cached under the system temp folder and are safe to delete.

## Tests

```sh
npm test          # one pass
npm run test:watch
```

The suite covers the data model, the save format and autosave behaviour, YouTube
URL parsing / title lookup, the crossfade volume and opacity ramp, and the UI
(rendered with jsdom).

For the reference shelf it covers phrase search and snippet cutting, the
extracted-text cache and its invalidation when a file changes, the folder server
(its listing, byte ranges, etags, and its refusal to serve anything outside the
folder), conversion of office documents and the cache around it, and real text
extraction — against a small PDF the tests generate themselves, so no binary
fixture is committed. LibreOffice is faked in the server tests, so the suite
never needs it installed.

The real YouTube player is never started in tests, so nothing touches the network.

## Layout

```
start.sh, start.cmd, dev.sh    launchers
index.html                     page shell
src/main.tsx                   entry point
src/App.tsx                    layout, state, wiring
src/model/types.ts             tracks, save schema
src/model/store.ts             local storage, autosave, import/export
src/music/youtube.ts           link parsing, placeholders, oEmbed titles
src/player/youtubeApi.ts       IFrame API loader and error messages
src/player/fade.ts             the crossfade curve (pure, tested)
src/player/useYouTubePlayer.ts the players, and the crossfade between them
src/pdf/library.ts             the shelf: what the server found in the folder
src/pdf/useDocuments.ts        the shelf, the search, and which page is open
src/pdf/extract.ts             reading a text layer out with pdf.js
src/pdf/search.ts              matching a phrase, cutting a snippet
src/pdf/searchLibrary.ts       cache-first search across the whole shelf
src/pdf/index-cache.ts         the extracted-text cache (IndexedDB)
src/components/                DocumentSidebar, DocumentViewer, MusicPanel,
                               StatusBar
tools/pdf-server.ts            serves the folder, and converts office files
pdfs/                          your reference documents (not version controlled)
tests/                         vitest suites
```

## Network use

The app serves its own files from `127.0.0.1`, and the same local server hands
your documents to your own browser. The only other requests it ever makes are to
`youtube.com` — the player script, and oEmbed lookups for titles — and only once
your music library is non-empty. (The player script is fetched as soon as you add
a track, so the first click can start playing straight away rather than
downloading a script first.)

Nothing about your music or your documents is sent anywhere.

## License

MIT.
