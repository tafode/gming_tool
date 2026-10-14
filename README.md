# GMing Tool

A small Game Master's desk for tabletop sessions: a chapter-by-chapter story
editor, a music library that plays YouTube tracks in place, and a drawer of
reference PDFs to look things up in.

It is a local web app. `./start.sh` builds it, serves it on
`http://127.0.0.1:4173/`, and opens your browser. There is no backend, no
account, no telemetry, and no server to remember to start beyond that script.

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

Nothing else: no `yt-dlp`, no media libraries, no system codecs.

## Running it

| Command | What it does |
| --- | --- |
| `./start.sh` | Build, serve on `http://127.0.0.1:4173/`, open the browser. |
| `PORT=8080 ./start.sh` | Same, on a different port. |
| `PDF_DIR=~/rpg-books ./start.sh` | Same, reading reference PDFs from another folder. |
| `start.cmd` | Same as `start.sh`, for Windows. |
| `./dev.sh` | Vite dev server with hot reload on port 5173. |

`start.sh` works on Linux and macOS, and on Windows from Git Bash (it will not
auto-open the browser there — just visit the printed URL).

## Your work is saved

- Everything lives in the browser's local storage and is written about a second
  after you stop typing. The status bar tells you when it is saved.
- Browser storage does not travel between machines, so use **Export** and
  **Import** in the header to carry a session between, say, Linux and Windows as
  a `.json` file.
- That file is byte-compatible with the format the earlier Rust build wrote to
  `~/.local/share/gming_tool/save.json` (or
  `%APPDATA%\gming_tool\data\save.json`), so existing saves import unchanged. It
  carries a `schema_version` so the format can keep evolving.
- If stored data is ever unreadable, a copy is kept aside and a fresh story is
  started rather than destroying anything.
- The reference drawer remembers its height, whether it is open, and which page
  of each document you were reading. Those are browser-local settings, kept out
  of the exported `.json` so that file stays just your story.

## What it does

**Story** — add chapters, switch between them, and write each chapter's text.
Chapters are auto-named `Chapter 1`, `Chapter 2`, … and never renumber.

**Music** — paste a YouTube link (watch, `youtu.be`, `embed`, `shorts` or `live`
URLs, or a bare video id), click a track to play it, and use play/pause, stop and
the volume slider. Tracks can be removed. Titles are fetched from YouTube's
public oEmbed endpoint, falling back to whatever the player reports.

Switching tracks **crossfades**. A second player starts the new video silently —
waiting until it is actually playing so there is no gap — and the two are then
blended, sound and picture together, over about a second and a half. Play, pause
and stop act on the current track as before; only a change of track blends.

**Reference** — a drawer under the story holds your PDFs and searches across all
of them at once (see below).

Deliberately out of scope for now: renaming/deleting/reordering chapters, and
reordering tracks.

## Reference PDFs

The **Reference** drawer sits under the story. Put your books in `pdfs/` next to
the project — the launcher creates the folder on first run — and they appear on
the shelf:

```
pdfs/
  rulebook.pdf
  adventures/Lost Mine.pdf     folders are fine, and are searched too
```

- **Reading** — click a document and it opens in your browser's own PDF viewer,
  so its built-in search, page box and zoom all work as usual.
- **Searching** — the box at the top searches **every** document at once. The
  text layer of each book is read once, the first time you search it (pdf.js, a
  page at a time, with progress shown), then cached in the browser and reused.
  Hits list the document and page with a snippet, the match highlighted;
  clicking one jumps the viewer to that page. Results are capped, so a word that
  appears on every page cannot flood the panel.
- **⌘/Ctrl-F inside the viewer** searches only the document you are reading. The
  drawer's box is for finding which book a rule is in.
- **Scanned books** have no text layer, so search cannot see inside them. The
  drawer names those documents instead of quietly finding nothing; they still
  display normally.
- **`PDF_DIR`** — to keep books elsewhere, `PDF_DIR=~/rpg-books ./start.sh`.

The folder is served by the same local server as the app, on `127.0.0.1` only,
with byte-range requests, so a 300 MB rulebook streams and seeks rather than
being copied into the browser first. Nothing is uploaded anywhere: the server
reads that one folder and hands out PDFs from inside it (paths that try to climb
out are refused).

## Tests

```sh
npm test          # one pass
npm run test:watch
```

The suite covers the data model, the save format and autosave behaviour, YouTube
URL parsing / title lookup, the crossfade volume and opacity ramp, and the UI
(rendered with jsdom).

For the reference drawer it covers phrase search and snippet cutting, the
extracted-text cache and its invalidation when a file changes, the folder server
(its listing, byte ranges, etags, and its refusal to serve anything outside the
folder), and real text extraction — against a small PDF the tests generate
themselves, so no binary fixture is committed.

The real YouTube player is never started in tests, so nothing touches the network.

## Layout

```
start.sh, start.cmd, dev.sh    launchers
index.html                     page shell
src/main.tsx                   entry point
src/App.tsx                    layout, state, wiring
src/model/types.ts             chapters, tracks, save schema
src/model/store.ts             local storage, autosave, import/export
src/music/youtube.ts           link parsing, placeholders, oEmbed titles
src/player/youtubeApi.ts       IFrame API loader and error messages
src/player/fade.ts             the crossfade curve (pure, tested)
src/player/useYouTubePlayer.ts the players, and the crossfade between them
src/pdf/library.ts             the shelf: what the server found in the folder
src/pdf/extract.ts             reading a text layer out with pdf.js
src/pdf/search.ts              matching a phrase, cutting a snippet
src/pdf/searchLibrary.ts       cache-first search across the whole shelf
src/pdf/index-cache.ts         the extracted-text cache (IndexedDB)
src/components/                ChapterSidebar, ChapterEditor, MusicPanel,
                               ReferencePanel, StatusBar
tools/pdf-server.ts            serves the PDF folder from the launcher
pdfs/                          your reference books (not version controlled)
tests/                         vitest suites
```

## Network use

The app serves its own files from `127.0.0.1`, and the same local server hands
your reference PDFs to your own browser. The only other requests it ever makes
are to `youtube.com` — the player script, and oEmbed lookups for titles — and
only once your music library is non-empty. (The player script is fetched as soon
as you add a track, so the first click can start playing straight away rather
than downloading a script first.)

Nothing about your story or your books is sent anywhere.

## License

MIT.
