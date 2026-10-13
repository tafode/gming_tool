# GMing Tool

A cross-platform TTRPG Game Master's session tool, written in Rust with
[eframe/egui](https://github.com/emilk/egui). Runs natively on Linux and Windows.

## Status

Milestone 2: story chapters. Add chapters from the left sidebar and write each
chapter's story text in a large editor; switching chapters swaps the text.

Data is **in-memory only** — it is not saved yet and is lost when the app closes.

## Requirements

- Rust 1.95+ (pinned via `rust-toolchain.toml`; install with [rustup](https://rustup.rs))

### Linux

On Debian/Ubuntu-based distros (including Zorin OS), the window/OpenGL build
dependencies:

```sh
sudo apt install libxkbcommon-dev libwayland-dev libx11-dev libgl1-mesa-dev
```

### Windows

Install the Rust toolchain plus the **MSVC build tools** (Visual Studio Build
Tools with the "Desktop development with C++" workload).

## Build and run

```sh
cargo run            # debug build + run
cargo build --release   # portable binary in target/release/
```

On Windows the binary is `target\release\gming_tool.exe`.

## Project layout

```
src/
├── main.rs   entry point: window setup + app startup
├── app.rs    UI shell (eframe::App) and layout
└── model.rs  story data: Story, Chapter, ChapterId
```

Planned growth: `ui/`, `model/`, `persistence/` modules. Save files will be
UTF-8 text with a `schema_version` field and no absolute OS-specific paths, so
they transfer cleanly between Linux and Windows.
