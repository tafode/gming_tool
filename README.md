# GMing Tool

A cross-platform TTRPG Game Master's session tool, written in Rust with
[eframe/egui](https://github.com/emilk/egui). Runs natively on Linux and Windows.

## Status

Milestone 1: opens an empty window. No features yet.

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
└── app.rs    root application state (eframe::App implementation)
```

Planned growth: `ui/`, `model/`, `persistence/` modules. Save files will be
UTF-8 text with a `schema_version` field and no absolute OS-specific paths, so
they transfer cleanly between Linux and Windows.
