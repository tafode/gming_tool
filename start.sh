#!/usr/bin/env bash
# Launch GMing Tool: build the app, serve it on localhost, and open your browser.
#
# The server hands out the app's own files and the documents in your folder, and
# converts Word/OpenDocument files to PDF locally. Nothing leaves your machine
# except the YouTube player itself.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}/"

# Reference documents: a folder of PDFs, Word (.docx) and OpenDocument (.odt)
# files to look things up in. Point it elsewhere with:
#   DOC_DIR=/somewhere/else ./start.sh
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

echo "Building…"
npm run build

echo "Reference documents: ${DOC_DIR}"
echo "Serving ${URL} — press Ctrl-C to stop."
npm run preview -- --host 127.0.0.1 --port "$PORT" &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT INT TERM

# Wait for the server to answer before opening a browser window on it.
for _ in $(seq 1 80); do
  if curl -fsS -o /dev/null "$URL" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 || true
elif command -v open >/dev/null 2>&1; then
  open "$URL" >/dev/null 2>&1 || true
fi

wait "$server_pid"
