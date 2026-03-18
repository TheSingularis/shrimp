{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = with pkgs; [
    ollama
    curl

    # python + backend deps
    python311
    python311Packages.fastapi
    python311Packages.uvicorn
    python311Packages.httpx
    python311Packages.pydantic

    # frontend
    nodejs_20
  ];

  shellHook = ''
    export OLLAMA_HOST="127.0.0.1:11434"
    export OLLAMA_MODELS="$HOME/.ollama/models"

    mkdir -p .ollama

    # ── ollama ────────────────────────────────────────────────
    echo "[shrimp] Starting Ollama..."
    ollama serve &> .ollama/serve.log &
    OLLAMA_PID=$!

    echo "[shrimp] Waiting for Ollama..."
    for i in $(seq 1 20); do
      curl -sf http://127.0.0.1:11434 > /dev/null 2>&1 && break
      sleep 0.5
    done

    ollama pull qwen2.5-coder:7b > /dev/null 2>&1 &
    ollama pull nomic-embed-text > /dev/null 2>&1 &

    # ── config ────────────────────────────────────────────────
    if [ ! -f "backend/config.py" ]; then
      echo "[shrimp] No config.py found — copying from config.example.py"
      cp backend/config.example.py backend/config.py
      echo "[shrimp] ⚠  Edit backend/config.py to set your watched directories"
    fi

    # ── fastapi ───────────────────────────────────────────────
    echo "[shrimp] Starting FastAPI backend..."
    cd backend && python -m uvicorn main:app --reload --port 8000 &> ../.ollama/backend.log &
    BACKEND_PID=$!
    cd ..

    # ── cleanup ───────────────────────────────────────────────
    cleanup() {
      echo ""
      echo "[shrimp] Shutting down..."
      kill $BACKEND_PID 2>/dev/null
      kill $OLLAMA_PID  2>/dev/null
      wait $BACKEND_PID $OLLAMA_PID 2>/dev/null
    }
    trap cleanup EXIT

    echo ""
    echo "┌─────────────────────────────────────────┐"
    echo "│           SHRIMP* is running            │"
    echo "│                                         │"
    echo "│  Ollama   →  http://127.0.0.1:11434     │"
    echo "│  API      →  http://127.0.0.1:8000      │"
    echo "│  API docs →  http://127.0.0.1:8000/docs │"
    echo "│                                         │"
    echo "│  logs: .ollama/serve.log                │"
    echo "│        .ollama/backend.log              │"
    echo "└─────────────────────────────────────────┘"
    echo ""
  '';
}
