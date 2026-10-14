#!/usr/bin/env bash
# Development server with hot reload. Press `o` then Enter, or just use the
# browser it opens, to reach the app.
set -euo pipefail
cd "$(dirname "$0")"

# Reference PDFs: a folder of rulebooks and adventures to look things up in.
# Point it elsewhere with: PDF_DIR=/somewhere/else ./dev.sh
PDF_DIR="${PDF_DIR:-$PWD/pdfs}"
case "$PDF_DIR" in
  "~") PDF_DIR="$HOME" ;;
  "~/"*) PDF_DIR="$HOME/${PDF_DIR#\~/}" ;;
esac
export PDF_DIR
mkdir -p "$PDF_DIR"

command -v npm >/dev/null 2>&1 || {
  echo "error: npm was not found — install Node.js 20 or newer first" >&2
  exit 1
}

if [ ! -d node_modules ]; then
  echo "Installing dependencies…"
  npm install
fi

npm run dev -- --host 127.0.0.1 --port 5173 --open
