# GMing Tool

A cross-platform TTRPG Game Master's session tool, written in Rust with
[eframe/egui](https://github.com/emilk/egui). Runs natively on Linux and Windows.

## Status

Milestone 4: story chapters, a music library, and real playback.

- **Chapters** — add chapters from the left sidebar and write each chapter's
  story text in a large editor; switching chapters swaps the text.
- **Music** — add YouTube URLs in the right panel, click a track to play it,
  and use the transport buttons and volume slider. Titles and audio are fetched
  with [yt-dlp](https://github.com/yt-dlp/yt-dlp) and played with
  [rodio](https://github.com/RustAudio/rodio). Tracks can be deleted.

Work is autosaved to disk a second after the last change (and on exit), so
nothing is lost when the app closes. See *Where your data lives* below.

The first time a track is added or played, the app downloads the official
standalone `yt-dlp` build (about 30 MB) into its own data directory. If you
already have `yt-dlp` on your `PATH`, that copy is used instead and nothing is
downloaded. `ffmpeg` is **not** required.

> **A note on YouTube** — downloading audio may violate YouTube's Terms of
> Service. Keep this to your own content or content you are permitted to use.

## Requirements

- Rust 1.95+ (pinned via `rust-toolchain.toml`; install with [rustup](https://rustup.rs))

### Linux

On Debian/Ubuntu-based distros (including Zorin OS), the window, graphics and
audio build dependencies:

```sh
sudo apt install libxkbcommon-dev libwayland-dev libx11-dev libgl1-mesa-dev libasound2-dev
```

On Fedora/RHEL-based distros, the audio library is in `alsa-lib-devel`.

### Windows

Install the Rust toolchain plus the **MSVC build tools** (Visual Studio Build
Tools with the "Desktop development with C++" workload).

## Build and run

```sh
cargo run            # debug build + run
cargo build --release   # portable binary in target/release/
```

On Windows the binary is `target\release\gming_tool.exe`.

## Where your data lives

The app keeps a small JSON save file in the per-user data directory for your
platform:

| Platform | Location |
| --- | --- |
| Linux | `~/.local/share/gming_tool/save.json` |
| Windows | `%APPDATA%\gming_tool\data\save.json` |

Cached audio lives in the corresponding cache directory
(`~/.cache/gming_tool/audio` on Linux), one file per video id. The save file is
plain UTF-8 JSON with a `schema_version` field and **no absolute OS-specific
paths**, so it can be copied between Linux and Windows. Audio and the downloaded
`yt-dlp` binary are per-machine and are re-fetched when needed:

| Platform | `yt-dlp` binary |
| --- | --- |
| Linux | `~/.local/share/gming_tool/bin/yt-dlp` |
| Windows | `%APPDATA%\gming_tool\data\bin\yt-dlp.exe` |

## Tests

```sh
cargo test     # model, persistence, audio and headless UI tests
```

The UI tests drive the real widgets through
[`egui_kittest`](https://crates.io/crates/egui_kittest) with fake audio and
resolver backends, so they need no display, no sound device and no network. The
real audio backend is exercised only when a sound device exists, and the tests
skip gracefully when it does not.

One end-to-end test is ignored by default because it downloads `yt-dlp` and a
video from YouTube:

```sh
cargo test -- --ignored real_yt_dlp
```

## Project layout

```
src/
├── main.rs          entry point: window setup + app startup
├── app.rs           UI shell (eframe::App), layout and interaction
├── model/
│   ├── mod.rs       story data: Story, Chapter, ChapterId, MusicLibrary, Track
│   └── store.rs     save/load: SaveData, AppDirs, atomic JSON writes
└── music/
    ├── mod.rs       YouTube URL helpers
    ├── output.rs    AudioOutput trait: rodio backend + silent fallback
    ├── resolver.rs  Resolver trait + yt-dlp backend
    └── yt_dlp.rs    finding/installing and driving the yt-dlp tool
```

The UI talks to the `AudioOutput` and `Resolver` traits rather than to concrete
implementations. That keeps the panel testable with fake backends, and lets the
app fall back to a silent backend when no audio device is available.

