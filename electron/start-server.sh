/usr/bin/env bash

SHRIMP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

info()  { echo -e "\033[0;32m[shrimp]\033[0m $*"; }
warn()  { echo -e "\033[0;33m[shrimp]\033[0m $*"; }
error() { echo -e "\033[0;31m[shrimp]\033[0m $*"; }

info "Checking system dependencies..."
PKGS=()
command -v curl        &>/dev/null || PKGS+=(curl)
command -v git         &>/dev/null || PKGS+=(git)
command -v python3     &>/dev/null || PKGS+=(python3)
command -v node        &>/dev/null || PKGS+=(nodejs npm)

if [ ${#PKGS[@]} -gt 0 ]; then
  info "Installing: ${PKGS[*]}"
  sudo pacman -Sy --noconfirm "${PKGS[@]}"
fi

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

info "Starting backend..."
( cd "$SHRIMP_DIR/backend" && \
  python -m uvicorn main:app \
    --reload \
    --reload-dir . \
    --host 0.0.0.0 \
    --port 8000 \
    &> "$SHRIMP_DIR/.ollama/backend.log" ) &
BACKEND_PID=$!

# Wait for backend to be ready
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:8000/automations > /dev/null 2>&1 && break
  sleep 0.5
done

info "Servers ready."

# Keep running until interrupted
trap 'info "Shutting down..."; kill $BACKEND_PID 2>/dev/null; kill $OLLAMA_PID 2>/dev/null; info "Stopped."' INT TERM

wait