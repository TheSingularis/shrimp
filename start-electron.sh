#!/usr/bin/env bash
set -e

SHRIMP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── colours ───────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; N='\033[0m'
info()  { echo -e "${G}[shrimp]${N} $*"; }
warn()  { echo -e "${Y}[shrimp]${N} $*"; }
error() { echo -e "${R}[shrimp]${N} $*"; }

# ── 1. system deps (idempotent) ───────────────────────────────────────────────
info "Checking system dependencies..."
PKGS=()
command -v curl        &>/dev/null || PKGS+=(curl)
command -v git         &>/dev/null || PKGS+=(git)
command -v python3     &>/dev/null || PKGS+=(python3)
command -v node        &>/dev/null || PKGS+=(nodejs npm)
command -v fuser       &>/dev/null || PKGS+=(psmisc)

# Electron system deps
for lib in nss libxss atk gtk3 libdrm alsa-lib mesa; do
  pacman -Q "$lib" &>/dev/null || PKGS+=("$lib")
done

if [ ${#PKGS[@]} -gt 0 ]; then
  info "Installing: ${PKGS[*]}"
  sudo pacman -Sy --noconfirm "${PKGS[@]}"
fi

# ── 2. ollama ─────────────────────────────────────────────────────────────────
if ! command -v ollama &>/dev/null; then
  info "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
fi

# ── 3. config check ───────────────────────────────────────────────────────────
if [ ! -f "$SHRIMP_DIR/backend/config.py" ]; then
  warn "No config.py found — copying from config.example.py"
  cp "$SHRIMP_DIR/backend/config.example.py" "$SHRIMP_DIR/backend/config.py"
  warn "Edit backend/config.py to set your watched directories, then re-run."
  exit 1
fi

# ── 4. python venv ────────────────────────────────────────────────────────────
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

# ── 5. frontend deps ──────────────────────────────────────────────────────────
if [ ! -d "$SHRIMP_DIR/frontend/node_modules" ]; then
  info "Installing frontend dependencies..."
  ( cd "$SHRIMP_DIR/frontend" && npm install )
fi

if [ ! -d "$SHRIMP_DIR/node_modules" ]; then
  info "Installing Electron..."
  ( cd "$SHRIMP_DIR" && npm install )
fi

# ── 6. build frontend for Electron ────────────────────────────────────────────
info "Building frontend..."
( cd "$SHRIMP_DIR/frontend" && ELECTRON=1 npm run build ) || {
  error "Frontend build failed"
  exit 1
}

# ── 7. clear stale ports ──────────────────────────────────────────────────────
info "Clearing stale ports..."
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 11434/tcp 2>/dev/null || true

# ── 8. start ollama ───────────────────────────────────────────────────────────
info "Starting Ollama..."
mkdir -p "$SHRIMP_DIR/.ollama"
OLLAMA_HOST="0.0.0.0:11434" \
OLLAMA_MODELS="$HOME/.ollama/models" \
OLLAMA_KEEP_ALIVE="15m" \
  ollama serve &> "$SHRIMP_DIR/.ollama/serve.log" &
OLLAMA_PID=$!

info "Waiting for Ollama..."
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:11434 > /dev/null 2>&1 && break
  sleep 0.5
done

# ── 9. start backend ──────────────────────────────────────────────────────────
info "Starting backend..."
( cd "$SHRIMP_DIR/backend" && \
  python -m uvicorn main:app \
    --reload \
    --reload-dir . \
    --host 0.0.0.0 \
    --port 8000 \
    &> "$SHRIMP_DIR/.ollama/backend.log" ) &
BACKEND_PID=$!

info "Waiting for backend..."
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:8000/automations > /dev/null 2>&1 && break
  sleep 0.5
done

# ── 10. launch electron ───────────────────────────────────────────────────────
cleanup() {
  echo ""
  info "Shutting down..."
  kill $BACKEND_PID 2>/dev/null
  kill $OLLAMA_PID 2>/dev/null
  fuser -k 8000/tcp 2>/dev/null || true
  fuser -k 11434/tcp 2>/dev/null || true
  info "Stopped."
}
trap cleanup EXIT INT TERM

info "Starting Electron..."
"$SHRIMP_DIR/node_modules/.bin/electron" "$SHRIMP_DIR" --no-sandbox --disable-gpu
