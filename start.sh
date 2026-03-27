#!/usr/bin/env bash
set -e

SHRIMP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── colours ───────────────────────────────────────────────────────────────────
G='\033[0;32m'; Y='\033[0;33m'; R='\033[0;31m'; N='\033[0m'
info()  { echo -e "${G}[shrimp]${N} $*"; }
warn()  { echo -e "${Y}[shrimp]${N} $*"; }
error() { echo -e "${R}[shrimp]${N} $*"; }

# ── sanity check: must run inside distrobox ───────────────────────────────────
if [ ! -f /run/.containerenv ] && [ -z "$DISTROBOX_ENTER_PATH" ]; then
  warn "Not inside a distrobox container."
  info "Enter the container first with: distrobox enter arch-dev"
  info "Then run: bash start.sh"
  exit 1
fi

# ── 1. system deps (idempotent) ───────────────────────────────────────────────
info "Checking system dependencies..."
PKGS=()
command -v curl        &>/dev/null || PKGS+=(curl)
command -v git         &>/dev/null || PKGS+=(git)
command -v python3     &>/dev/null || PKGS+=(python3)
command -v node        &>/dev/null || PKGS+=(nodejs npm)
command -v fuser       &>/dev/null || PKGS+=(psmisc)

if [ ${#PKGS[@]} -gt 0 ]; then
  info "Installing: ${PKGS[*]}"
  sudo pacman -Sy --noconfirm "${PKGS[@]}"
fi

# ── 2. ollama ─────────────────────────────────────────────────────────────────
if ! command -v ollama &>/dev/null; then
  info "Installing Ollama (official installer)..."
  curl -fsSL https://ollama.com/install.sh | sh
else
  info "Ollama already installed: $(ollama --version)"
fi

# ── 3. ROCm for RX 9060 XT (gfx1200) ─────────────────────────────────────────
# rocm-hip-runtime is the runtime; hip-runtime-amd pulls in the right userspace libs
if ! pacman -Q rocm-hip-runtime &>/dev/null; then
  info "Installing ROCm (this may take a while)..."
  sudo pacman -Sy --noconfirm rocm-hip-runtime rocm-opencl-runtime
else
  info "ROCm already installed: $(pacman -Q rocm-hip-runtime)"
fi

# ── 4. GPU env vars ───────────────────────────────────────────────────────────
export HSA_OVERRIDE_GFX_VERSION="12.0.0"
export ROCR_VISIBLE_DEVICES="0"

# ── 5. config ─────────────────────────────────────────────────────────────────
if [ ! -f "$SHRIMP_DIR/backend/config.py" ]; then
  warn "No config.py found — copying from config.example.py"
  cp "$SHRIMP_DIR/backend/config.example.py" "$SHRIMP_DIR/backend/config.py"
  warn "⚠  Edit backend/config.py to set your watched directories, then re-run."
  exit 1
fi

# ── 6. python venv ────────────────────────────────────────────────────────────
if [ ! -d "$SHRIMP_DIR/backend/.venv" ]; then
  info "Creating Python venv..."
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
  sse-starlette

# ── 7. frontend deps ──────────────────────────────────────────────────────────
if [ ! -d "$SHRIMP_DIR/frontend/node_modules" ]; then
  info "Installing frontend dependencies..."
  ( cd "$SHRIMP_DIR/frontend" && npm install )
fi

# ── 8. clear stale ports ──────────────────────────────────────────────────────
info "Clearing stale ports..."
fuser -k 8000/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true
fuser -k 11434/tcp 2>/dev/null || true

# ── 9. start ollama ───────────────────────────────────────────────────────────
info "Starting Ollama..."
OLLAMA_HOST="0.0.0.0:11434" \
OLLAMA_MODELS="$HOME/.ollama/models" \
OLLAMA_KEEP_ALIVE="15m" \
HSA_OVERRIDE_GFX_VERSION="12.0.0" \
ROCR_VISIBLE_DEVICES="0" \
  ollama serve &> "$SHRIMP_DIR/.ollama/serve.log" &
OLLAMA_PID=$!

info "Waiting for Ollama..."
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:11434 > /dev/null 2>&1 && break
  sleep 0.5
done

# pull models in background — they're already cached after first run
ollama pull qwen2.5-coder:7b  > /dev/null 2>&1 &
ollama pull nomic-embed-text  > /dev/null 2>&1 &

# ── 10. start backend ─────────────────────────────────────────────────────────
info "Starting FastAPI backend..."
mkdir -p "$SHRIMP_DIR/.ollama"
( cd "$SHRIMP_DIR/backend" && \
  python -m uvicorn main:app \
    --reload \
    --reload-dir . \
    --host 0.0.0.0 \
    --port 8000 \
    &> "$SHRIMP_DIR/.ollama/backend.log" ) &
BACKEND_PID=$!

# ── 11. start frontend ────────────────────────────────────────────────────────
info "Starting frontend..."
rm -rf "$SHRIMP_DIR/frontend/node_modules/.vite"
( cd "$SHRIMP_DIR/frontend" && npm run dev &> "$SHRIMP_DIR/.ollama/frontend.log" ) &
FRONTEND_PID=$!

# ── 12. cleanup on exit ───────────────────────────────────────────────────────
cleanup() {
  echo ""
  info "Shutting down..."
  kill $BACKEND_PID $OLLAMA_PID $FRONTEND_PID 2>/dev/null
  wait $BACKEND_PID $OLLAMA_PID $FRONTEND_PID 2>/dev/null
}
trap cleanup EXIT INT TERM

# ── 13. wait for vite and print banner ───────────────────────────────────────
info "Waiting for frontend..."
for i in $(seq 1 20); do
  vite_url=$(grep -o 'http://localhost:[0-9]*' "$SHRIMP_DIR/.ollama/frontend.log" 2>/dev/null | head -1)
  [ -n "$vite_url" ] && break
  sleep 0.5
done
vite_url="${vite_url:-http://localhost:5173}"

# verify GPU is actually being used
sleep 2
GPU_STATUS=$(ollama ps 2>/dev/null | grep -i "gpu" || echo "CPU (model not loaded yet)")

# get local IP for network access (try multiple methods)
LOCAL_IP=$(
  # Try ip route - most reliable in containers
  ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' ||
  # Try hostname -I
  hostname -I 2>/dev/null | awk '{print $1}' ||
  # Try ip addr
  ip -4 addr show 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '^127\.' | head -1 ||
  # Fallback: show placeholder with instructions
  echo "<YOUR-IP>"
)

echo ""
echo "┌─────────────────────────────────────────┐"
echo "│           SHRIMP* is running            │"
echo "│                                         │"
echo "│  Local:                                 │"
echo "│    UI     →  http://localhost:5173      │"
echo "│    API    →  http://localhost:8000      │"
echo "│    Ollama →  http://localhost:11434     │"
echo "│                                         │"
echo "│  Network (LAN/Tailscale):               │"
printf "│    UI     →  http://%-17s  │\n" "$LOCAL_IP:5173"
printf "│    API    →  http://%-17s  │\n" "$LOCAL_IP:8000"
echo "│                                         │"
echo "│  Logs:                                  │"
echo "│    .ollama/serve.log                    │"
echo "│    .ollama/backend.log                  │"
echo "│    .ollama/frontend.log                 │"
echo "└─────────────────────────────────────────┘"
echo ""
info "GPU status: $GPU_STATUS"
info "Press Ctrl+C to shut down."
echo ""

# keep script alive so trap fires on Ctrl+C
wait $BACKEND_PID
