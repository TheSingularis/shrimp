{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = with pkgs; [
    curl
    psmisc
    patchelf

    python311
    python311Packages.pip
    python311Packages.virtualenv
    python311Packages.fastapi
    python311Packages.uvicorn
    python311Packages.httpx
    python311Packages.pydantic

    rocmPackages.rocm-runtime
    rocmPackages.clr

    stdenv.cc.cc.lib
    zlib

    nodejs_20
  ];

  shellHook = ''
    SHRIMP_DIR="$PWD"

    export LD_LIBRARY_PATH="${pkgs.stdenv.cc.cc.lib}/lib:${pkgs.zlib}/lib:${pkgs.rocmPackages.rocm-runtime}/lib:${pkgs.rocmPackages.clr}/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

    export OLLAMA_HOST="127.0.0.1:11434"
    export OLLAMA_MODELS="$HOME/.ollama/models"
    export OLLAMA_KEEP_ALIVE="15m"
    export HSA_OVERRIDE_GFX_VERSION="12.0.0"
    export ROCR_VISIBLE_DEVICES="0"
    export HIP_PATH="${pkgs.rocmPackages.clr}"
    export ROCM_PATH="${pkgs.rocmPackages.rocm-runtime}"

    mkdir -p "$SHRIMP_DIR/.ollama/bin"

    # ── download official ollama binary if not present ────────
    OLLAMA_BIN="$SHRIMP_DIR/.ollama/bin/ollama"
    OLLAMA_VERSION="v0.6.5"
    if [ ! -f "$OLLAMA_BIN" ]; then
      echo "[shrimp] Downloading official Ollama $OLLAMA_VERSION..."
      curl -L "https://github.com/ollama/ollama/releases/download/$OLLAMA_VERSION/ollama-linux-amd64.tgz" \
        -o "$SHRIMP_DIR/.ollama/ollama.tgz"
      echo "[shrimp] Download complete. Extracting binary..."
      tar -xzf "$SHRIMP_DIR/.ollama/ollama.tgz" -C "$SHRIMP_DIR/.ollama/"
      rm "$SHRIMP_DIR/.ollama/ollama.tgz"
      echo "[shrimp] Patching Ollama binary for NixOS..."
      patchelf \
        --set-interpreter "$(cat ${pkgs.stdenv.cc}/nix-support/dynamic-linker)" \
        --set-rpath "${pkgs.stdenv.cc.cc.lib}/lib:${pkgs.zlib}/lib:${pkgs.glibc}/lib:${pkgs.rocmPackages.rocm-runtime}/lib:${pkgs.rocmPackages.clr}/lib" \
        "$OLLAMA_BIN"
      echo "[shrimp] Ollama ready."
    fi

    echo "[shrimp] Starting Ollama (ROCm gfx1200)..."
    "$OLLAMA_BIN" serve &> "$SHRIMP_DIR/.ollama/serve.log" &
    OLLAMA_PID=$!

    echo "[shrimp] Waiting for Ollama..."
    for i in $(seq 1 20); do
      curl -sf http://127.0.0.1:11434 > /dev/null 2>&1 && break
      sleep 0.5
    done

    "$OLLAMA_BIN" pull qwen2.5-coder:7b > /dev/null 2>&1 &
    "$OLLAMA_BIN" pull nomic-embed-text > /dev/null 2>&1 &

    if [ ! -f "$SHRIMP_DIR/backend/config.py" ]; then
      echo "[shrimp] No config.py found — copying from config.example.py"
      cp "$SHRIMP_DIR/backend/config.example.py" "$SHRIMP_DIR/backend/config.py"
      echo "[shrimp] ⚠  Edit backend/config.py to set your watched directories"
    fi

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
      chromadb \
      sse-starlette

    REAL_PYTHON=$(readlink -f "$SHRIMP_DIR/backend/.venv/bin/python")
    NIX_LIBS="${pkgs.stdenv.cc.cc.lib}/lib:${pkgs.zlib}/lib:${pkgs.rocmPackages.rocm-runtime}/lib:${pkgs.rocmPackages.clr}/lib"
    cat > "$SHRIMP_DIR/backend/.venv/bin/python" << WRAPPER
#!/bin/sh
export LD_LIBRARY_PATH="$NIX_LIBS\''${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"
exec "$REAL_PYTHON" "\$@"
WRAPPER
    chmod +x "$SHRIMP_DIR/backend/.venv/bin/python"
    cp "$SHRIMP_DIR/backend/.venv/bin/python" "$SHRIMP_DIR/backend/.venv/bin/python3"
    cp "$SHRIMP_DIR/backend/.venv/bin/python" "$SHRIMP_DIR/backend/.venv/bin/python3.11"

    echo "[shrimp] Clearing stale ports..."
    fuser -k 8000/tcp 2>/dev/null || true
    fuser -k 5173/tcp 2>/dev/null || true
    fuser -k 11434/tcp 2>/dev/null || true

    echo "[shrimp] Starting FastAPI backend..."
    VENV_PYTHON="$SHRIMP_DIR/backend/.venv/bin/python"
    ( cd "$SHRIMP_DIR/backend" && "$VENV_PYTHON" -m uvicorn main:app --reload --reload-dir . --port 8000 &> "$SHRIMP_DIR/.ollama/backend.log" ) &
    BACKEND_PID=$!

    echo "[shrimp] Starting frontend..."
    rm -rf "$SHRIMP_DIR/frontend/node_modules/.vite"
    ( cd "$SHRIMP_DIR/frontend" && npm run dev &> "$SHRIMP_DIR/.ollama/frontend.log" ) &
    FRONTEND_PID=$!

    cleanup() {
      echo ""
      echo "[shrimp] Shutting down..."
      kill $BACKEND_PID $OLLAMA_PID $FRONTEND_PID 2>/dev/null
      wait $BACKEND_PID $OLLAMA_PID $FRONTEND_PID 2>/dev/null
    }
    trap cleanup EXIT

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
