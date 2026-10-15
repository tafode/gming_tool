#!/usr/bin/env bash
# Development server with hot reload. Press `o` then Enter, or just use the
# browser it opens, to reach the app.
set -euo pipefail
cd "$(dirname "$0")"

# Reference documents: a folder of PDFs, Word (.docx) and OpenDocument (.odt)
# files to look things up in. Point it elsewhere with:
#   DOC_DIR=/somewhere/else ./dev.sh
DOC_DIR="${DOC_DIR:-${PDF_DIR:-$PWD/pdfs}}"
case "$DOC_DIR" in
  "~") DOC_DIR="$HOME" ;;
  "~/"*) DOC_DIR="$HOME/${DOC_DIR#\~/}" ;;
esac
export DOC_DIR
# Kept so older setups that only know PDF_DIR keep working.
export PDF_DIR="$DOC_DIR"
mkdir -p "$DOC_DIR"

command -v npm >/dev/null 2>&1 || {
  echo "error: npm was not found — install Node.js 20 or newer first" >&2
  exit 1
}

if [ ! -d node_modules ]; then
  echo "Installing dependencies…"
  npm install
fi

npm run dev -- --host 127.0.0.1 --port 5173 --open
