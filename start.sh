#!/bin/bash
cd "$(dirname "$0")"
PORT="${1:-8765}"
echo "Moze site → http://localhost:$PORT"
python3 -m http.server "$PORT"