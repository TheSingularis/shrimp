#!/usr/bin/env bash
set -e

SHRIMP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── colours ───────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; N='\033[0m'
info()  { echo -e "${G}[shrimp]${N} $*"; }
warn()  { echo -e "${Y}[shrimp]${N} $*"; }
error() { echo -e "${R}[shrimp]${N} $*"; }

# ── 1. check system deps ──────────────────────────────────────────────────────
info "Checking system dependencies..."
MISSING=()
command -v curl        &>/dev/null || MISSING+=(curl)
command -v git         &>/dev/null || MISSING+=(git)
command -v python3     &>/dev/null || MISSING+=(python3)
command -v node        &>/dev/null || MISSING+=(nodejs)
command -v npm         &>/dev/null || MISSING+=(npm)
command -v fuser       &>/dev/null || MISSING+=(fuser)

if [ ${#MISSING[@]} -gt 0 ]; then
  error "Missing required commands: ${MISSING[*]}"
  echo ""
  echo "On Arch/Manjaro, install with:"
  echo "  sudo pacman -S curl git python3 nodejs npm psmisc"
  echo ""
  echo "On Ubuntu/Debian, install with:"
  echo "  sudo apt install curl git python3 nodejs npm psmisc"
  echo ""
  echo "On macOS, install with:"
  echo "  brew install curl git python3 node psmisc"
  exit 1
fi

# ── 2. config ────────────────────────────────────────────────────────────────
if [ ! -f "$SHRIMP_DIR/backend/config.py" ]; then
  info "No config.py found — copying defaults from config.example.py"
  cp "$SHRIMP_DIR/backend/config.example.py" "$SHRIMP_DIR/backend/config.py"
fi

# ── 3. python venv ───────────────────────────────────────────────────────────
if [ ! -d "$SHRIMP_DIR/backend/.venv" ] || [ ! -x "$SHRIMP_DIR/backend/.venv/bin/python" ]; then
  info "Creating Python venv..."
  rm -rf "$SHRIMP_DIR/backend/.venv"
  python3 -m venv "$SHRIMP_DIR/backend/.venv"
fi

source "$SHRIMP_DIR/backend/.venv/bin/activate"

info "Installing Python dependencies..."
pip install --quiet \
  fastapi uvicorn httpx \
  llama-index \
  llama-index-llms-ollama \
  llama-index-embeddings-ollama \
  llama-index-vector-stores-chroma \
  chromadb \
  sse-starlette \
  apscheduler

# ── 4. frontend deps ──────────────────────────────────────────────────────────
if [ ! -d "$SHRIMP_DIR/frontend/node_modules" ]; then
  info "Installing frontend dependencies..."
  ( cd "$SHRIMP_DIR/frontend" && npm install )
fi

# ── 5. clear stale ports ──────────────────────────────────────────────────────
info "Clearing stale ports..."
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true

# ── 6. start backend ──────────────────────────────────────────────────────────
info "Starting FastAPI backend..."
( cd "$SHRIMP_DIR/backend" && \
  python -m uvicorn main:app \
    --reload \
    --reload-dir . \
    --host 0.0.0.0 \
    --port 8000 \
    &> "$SHRIMP_DIR/.ollama/backend.log" ) &
BACKEND_PID=$!

# ── 7. start frontend ───────────────────────────────────────────────────────
info "Starting frontend..."
rm -rf "$SHRIMP_DIR/frontend/node_modules/.vite"
( cd "$SHRIMP_DIR/frontend" && npm run dev &> "$SHRIMP_DIR/.ollama/frontend.log" ) &
FRONTEND_PID=$!

# ── 8. cleanup on exit ───────────────────────────────────────────────────────
cleanup() {
  echo ""
  info "Shutting down..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
}
trap cleanup EXIT INT TERM

# ── 9. wait for frontend and print banner ───────────────────────────────────
info "Waiting for frontend..."
for i in $(seq 1 20); do
  vite_url=$(grep -o 'http://localhost:[0-9]*' "$SHRIMP_DIR/.ollama/frontend.log" 2>/dev/null | head -1)
  [ -n "$vite_url" ] && break
  sleep 0.5
done
vite_url="${vite_url:-http://localhost:5173}"

# get local IP for network access
LOCAL_IP=$(
  ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' ||
  hostname -I 2>/dev/null | awk '{print $1}' ||
  echo "<YOUR-IP>"
)

echo ""
echo "┌─────────────────────────────────────────┐"
echo "│           SHRIMP* is running            │"
echo "│                                         │"
echo "│  Local:                                 │"
echo "│    UI     →  http://localhost:5173      │"
echo "│    API    →  http://localhost:8000      │"
echo "│                                         │"
echo "│  Logs:                                  │"
echo "│    .ollama/backend.log                  │"
echo "│    .ollama/frontend.log                 │"
echo "│                                         │"
echo "│  Note: Ollama should be running on      │"
echo "│  a standalone instance (not in this     │"
echo "│  script).                               │"
echo "└─────────────────────────────────────────┘"
echo ""
info "Press Ctrl+C to shut down."
echo ""

# keep script alive so trap fires on Ctrl+C
# monitor both processes; if either dies, keep the script alive to let trap handle cleanup
while kill -0 $BACKEND_PID 2>/dev/null || kill -0 $FRONTEND_PID 2>/dev/null; do
  sleep 1
done
