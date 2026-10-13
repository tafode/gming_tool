# GMing Tool

A small Game Master's desk for tabletop sessions: a chapter-by-chapter story
editor with a music library that plays YouTube tracks in place.

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

## What it does

**Story** — add chapters, switch between them, and write each chapter's text.
Chapters are auto-named `Chapter 1`, `Chapter 2`, … and never renumber.

**Music** — paste a YouTube link (watch, `youtu.be`, `embed`, `shorts` or `live`
URLs, or a bare video id), click a track to play it, and use play/pause, stop and
the volume slider. Tracks can be removed. Titles are fetched from YouTube's
public oEmbed endpoint, falling back to whatever the player reports.

Deliberately out of scope for now: renaming/deleting/reordering chapters, and
reordering tracks.

## Tests

```sh
npm test          # one pass
npm run test:watch
```

The suite covers the data model, the save format and autosave behaviour, YouTube
URL parsing / title lookup, and the UI (rendered with jsdom). The real YouTube
player is never started in tests, so nothing touches the network.

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
src/player/useYouTubePlayer.ts the player itself
src/components/                ChapterSidebar, ChapterEditor, MusicPanel, StatusBar
tests/                         vitest suites
```

## Network use

The app serves its own files from `127.0.0.1`. The only other requests it ever
makes are to `youtube.com` — the player script, and oEmbed lookups for titles —
and only once your music library is non-empty. (The player script is fetched as
soon as you add a track, so the first click can start playing straight away
rather than downloading a script first.)

## License

MIT.
