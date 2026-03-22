# SHRIMP* — TODO

Items are grouped by effort. Within each group, recommended order top to bottom.

---

## Quick wins

- [X] **Discard button** — abandon a pending file edit without applying it. Clears
      the entry from `pendingEdits` and closes the diff panel.

- [ ] **Stop / cancel button** — abort an in-flight streaming response. Frontend
      closes the reader; backend needs the stream generator to respect an
      `asyncio.Event` or the client disconnect signal.

- [ ] **Better streaming UI during file edits** — currently shows a static
      "Expanding…" pill while the model generates. Show a spinner or live token
      stream during generation; snap to the formatted pill + diff panel when
      streaming finishes.

- [ ] **Context window slider in settings** — expose `num_ctx` as a user setting
      with fixed snap points (2048 / 4096 / 8192 / 16384 / 32768). Persist to
      `config.py`. Apply to all Ollama API calls.

---

## Medium effort

- [ ] **Additional prompt instructions in settings** — a freetext field in the
      settings drawer that appends custom instructions to the system prompt.
      Useful for tuning SHRIMP's tone, focus, or domain knowledge per project
      without touching code. Persist to `config.py`.

- [ ] **Save conversations** — persist chat history to JSON files on disk
      (one file per conversation). Auto-save after each exchange.

- [ ] **Multiple conversation tabs** — extend saved conversations to support
      multiple named tabs open simultaneously in the UI.

- [ ] **Fork conversations** — branch a conversation from any point in history
      into a new tab. Requires a tree structure for history rather than a flat
      array.

- [ ] **Multiple file edits in one session** — currently the edit chain only
      operates on the first matched file. Extend to handle requests that
      reference multiple files, running the extract → generate → splice chain
      per file and emitting one sentinel per file.

- [ ] **Mobile-responsive CSS** — make the layout work on small screens so the
      app is usable from a phone browser on the same network. Pairs with the
      network binding fix below.

---

## Larger efforts

### Ollama host settings

- [ ] **Local vs external Ollama toggle in settings UI** — radio/toggle between:
      - *Local* — Ollama managed by SHRIMP (bundled binary or system install)
      - *External* — user-supplied URL (e.g. `http://192.168.1.50:11434`)
- [ ] **Persist Ollama host to config** — update `write_config` and the settings
      endpoint to save `OLLAMA_HOST` changes at runtime.
- [ ] **Fix loopback binding for network access** — when accessed from another
      device (phone, tablet, other PC on LAN), `127.0.0.1` does not resolve.
      - FastAPI must bind to `0.0.0.0` (already done via uvicorn flag, verify)
      - Frontend API base URL must not be hardcoded to `localhost` — detect or
        configure the host's LAN IP/hostname at startup and inject it into the
        Vite build or pass it via a `/config` endpoint the frontend fetches on
        load.
      - Ollama's `OLLAMA_HOST` must also not be `127.0.0.1` if external clients
        need to reach it directly.

### Electron app

- [ ] **Package as Electron** — wrap the existing Vite frontend + FastAPI backend
      into an Electron shell.
      - Frontend: already a Vite SPA, minimal changes needed.
      - Backend: bundle Python + venv or switch to a compiled binary (PyInstaller
        or similar); start FastAPI as a child process from the Electron main
        process.
      - Ollama: default to bundled local binary (already downloaded into
        `.ollama/bin/` by `start.sh`); respect the local/external toggle.
- [ ] **Bundled vs external Ollama in Electron** — "local" mode starts the
      `.ollama/bin/ollama serve` child process from within Electron; "external"
      mode skips that and points at the user-supplied URL.
- [ ] **Add API key model support (future)** — after Ollama options are solid,
      add a provider switcher for Claude (Anthropic API) and OpenAI. Store API
      keys securely (OS keychain via `keytar` or equivalent). Abstract the model
      call layer so frontend/backend don't need to know which provider is active.

---

## Nice to have / unsorted

- [ ] **"Save to Home Screen" mobile PWA** — add a `manifest.json` and service
      worker so the app can be installed as a PWA on iOS/Android. Requires the
      network binding fix above so the phone can reach the host.
- [ ] **Per-scope prompt context** — let each scope have an optional description
      or instruction that gets injected into the system prompt when that scope is
      active (e.g. "this is a D&D campaign notes vault").
- [ ] **Index status indicator in header** — small dot or badge showing whether
      the active scopes are indexed and up to date, without opening settings.
- [ ] **File edit history** — track all edits made in a session with timestamps,
      even after apply, so you can review what changed.
