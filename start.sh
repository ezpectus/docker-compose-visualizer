#!/usr/bin/env bash
# Compose Visualizer launcher (Linux / macOS)
set -e

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js is not installed. Get it at https://nodejs.org"
    exit 1
fi

if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    npm install
fi

echo "Starting dev server at http://localhost:5173 ..."
if command -v xdg-open >/dev/null 2>&1; then
    (sleep 2 && xdg-open http://localhost:5173) &   # Linux
elif command -v open >/dev/null 2>&1; then
    (sleep 2 && open http://localhost:5173) &        # macOS
fi

NO_COLOR=1 npm run dev
