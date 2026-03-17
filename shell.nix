{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  packages = with pkgs; [
    ollama
    python311
    python311Packages.pip
    nodejs_20
  ];

  shellHook = ''
    export OLLAMA_HOST="127.0.0.1:11434"
    export OLLAMA_MODELS="$HOME/.ollama/models"

    # ensure log dir exists
    mkdir -p .ollama

    echo "Starting Ollama..."
    ollama serve &> .ollama/serve.log &
    OLLAMA_PID=$!

    # wait for Ollama to be ready before pulling
    echo "Waiting for Ollama to be ready..."
    for i in $(seq 1 20); do
      if curl -sf http://127.0.0.1:11434 > /dev/null 2>&1; then
        break
      fi
      sleep 0.5
    done

    # pull models if not already present
    ollama pull qwen2.5-coder:7b   2>/dev/null &
    ollama pull nomic-embed-text   2>/dev/null &

    cleanup() {
      echo "Stopping Ollama..."
      kill $OLLAMA_PID 2>/dev/null
      wait $OLLAMA_PID 2>/dev/null
    }
    trap cleanup EXIT

    echo "Ollama running at $OLLAMA_HOST (pid $OLLAMA_PID)"
    echo "Models pulling in background — run 'ollama list' to check progress"
  '';
}
