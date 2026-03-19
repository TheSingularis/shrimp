{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = with pkgs; [
    ollama
    curl
    psmisc   # provides fuser for port cleanup

    # python + backend deps
    python311
    python311Packages.pip
    python311Packages.virtualenv
    python311Packages.fastapi
    python311Packages.uvicorn
    python311Packages.httpx
    python311Packages.pydantic

    # native libs required by pip-installed numpy/chromadb on NixOS
    stdenv.cc.cc.lib
    zlib

    # frontend
    nodejs_20
  ];

  shellHook = ''
    # capture project root immediately — $PWD may contain spaces
    SHRIMP_DIR="$PWD"

    # make libstdc++.so.6 and libz.so visible to pip-installed C-extension packages
    export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib:${pkgs.zlib}/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

    export OLLAMA_HOST="127.0.0.1:11434"
    export OLLAMA_MODELS="$HOME/.ollama/models"

    mkdir -p "$SHRIMP_DIR/.ollama"

    # ── ollama ────────────────────────────────────────────────
    echo "[shrimp] Starting Ollama..."
    ollama serve &> "$SHRIMP_DIR/.ollama/serve.log" &
    OLLAMA_PID=$!

    echo "[shrimp] Waiting for Ollama..."
    for i in $(seq 1 20); do
      curl -sf http://127.0.0.1:11434 > /dev/null 2>&1 && break
      sleep 0.5
    done

    ollama pull qwen2.5-coder:7b > /dev/null 2>&1 &
    ollama pull nomic-embed-text > /dev/null 2>&1 &

    # ── config ────────────────────────────────────────────────
    if [ ! -f "$SHRIMP_DIR/backend/config.py" ]; then
      echo "[shrimp] No config.py found — copying from config.example.py"
      cp "$SHRIMP_DIR/backend/config.example.py" "$SHRIMP_DIR/backend/config.py"
      echo "[shrimp] ⚠  Edit backend/config.py to set your watched directories"
    fi

    # ── python venv ───────────────────────────────────────────
    # Always rebuild the venv so the LD_LIBRARY_PATH wrapper is always current
    # and pip packages are always fresh. Fast on repeat runs (pip uses cache).
    echo "[shrimp] Rebuilding Python venv..."
    rm -rf "$SHRIMP_DIR/backend/.venv"
    python -m venv "$SHRIMP_DIR/backend/.venv"

    source "$SHRIMP_DIR/backend/.venv/bin/activate"

    echo "[shrimp] Installing Python dependencies..."
    pip install --quiet \
      fastapi uvicorn httpx \
      llama-index \
      llama-index-llms-ollama \
      llama-index-embeddings-ollama \
      llama-index-vector-stores-chroma \
      chromadb

    # Wrap the venv Python binary so LD_LIBRARY_PATH is set before the dynamic
    # linker runs — this is the only approach that works for uvicorn --reload
    # subprocesses on NixOS, since setting it inside Python is already too late.
    REAL_PYTHON=$(readlink -f "$SHRIMP_DIR/backend/.venv/bin/python")
    NIX_LIBS="${pkgs.stdenv.cc.cc.lib}/lib:${pkgs.zlib}/lib"
    cat > "$SHRIMP_DIR/backend/.venv/bin/python" << WRAPPER
#!/bin/sh
export LD_LIBRARY_PATH="$NIX_LIBS\''${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
exec "$REAL_PYTHON" "\$@"
WRAPPER
    chmod +x "$SHRIMP_DIR/backend/.venv/bin/python"
    # keep python3 and python3.11 consistent
    cp "$SHRIMP_DIR/backend/.venv/bin/python" "$SHRIMP_DIR/backend/.venv/bin/python3"
    cp "$SHRIMP_DIR/backend/.venv/bin/python" "$SHRIMP_DIR/backend/.venv/bin/python3.11"

    # ── clear stale ports ────────────────────────────────────
    echo "[shrimp] Clearing stale ports..."
    fuser -k 8000/tcp 2>/dev/null || true
    fuser -k 5173/tcp 2>/dev/null || true

    # ── fastapi ───────────────────────────────────────────────
    echo "[shrimp] Starting FastAPI backend..."
    VENV_PYTHON="$SHRIMP_DIR/backend/.venv/bin/python"
    ( cd "$SHRIMP_DIR/backend" && "$VENV_PYTHON" -m uvicorn main:app --reload --reload-dir . --port 8000 &> "$SHRIMP_DIR/.ollama/backend.log" ) &
    BACKEND_PID=$!

    # ── frontend ──────────────────────────────────────────────
    echo "[shrimp] Starting frontend..."
    rm -rf "$SHRIMP_DIR/frontend/node_modules/.vite"
    ( cd "$SHRIMP_DIR/frontend" && npm run dev &> "$SHRIMP_DIR/.ollama/frontend.log" ) &
    FRONTEND_PID=$!

    # ── cleanup ───────────────────────────────────────────────
    cleanup() {
      echo ""
      echo "[shrimp] Shutting down..."
      kill $BACKEND_PID $OLLAMA_PID $FRONTEND_PID 2>/dev/null
      wait $BACKEND_PID $OLLAMA_PID $FRONTEND_PID 2>/dev/null
    }
    trap cleanup EXIT

    # wait for Vite to report its URL, then extract the actual port
    echo "[shrimp] Waiting for frontend..."
    for i in $(seq 1 20); do
      vite_url=$(grep -o 'http://localhost:[0-9]*' "$SHRIMP_DIR/.ollama/frontend.log" 2>/dev/null | head -1)
      [ -n "$vite_url" ] && break
      sleep 0.5
    done
    vite_url="''${vite_url:-http://localhost:5173}"

    echo ""
    echo "┌─────────────────────────────────────────┐"
    echo "│           SHRIMP* is running            │"
    echo "│                                         │"
    echo "│  Ollama   →  http://127.0.0.1:11434     │"
    echo "│  API      →  http://127.0.0.1:8000      │"
    echo "│  API docs →  http://127.0.0.1:8000/docs │"
    printf  "│  UI       →  %-27s│\n" "$vite_url"
    echo "│                                         │"
    echo "│  logs: .ollama/serve.log                │"
    echo "│        .ollama/backend.log              │"
    echo "│        .ollama/frontend.log             │"
    echo "└─────────────────────────────────────────┘"
    echo ""
  '';
}
