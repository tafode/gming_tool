#!/usr/bin/env bash
# Launch GMing Tool: build the app, serve it on localhost, and open your browser.
#
# The server only ever hands out the app's own static files — there is no
# backend, and nothing leaves your machine except the YouTube player itself.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}/"

# Reference PDFs: a folder of rulebooks and adventures to look things up in.
# Point it elsewhere with: PDF_DIR=/somewhere/else ./start.sh
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

echo "Building…"
npm run build

echo "Reference PDFs: ${PDF_DIR}"
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
