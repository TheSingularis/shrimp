# SHRIMP\*

**Self-Hosted RAG Intelligence Model Project**

A local-first AI assistant that knows your files. Point it at your code, notes, or any directory — it indexes everything locally and uses that context when you chat with it. All inference runs on your machine via [Ollama](https://ollama.com). Nothing leaves your network.

---

## What it does

- **Chat with context** — ask questions about your own files and get answers grounded in their actual content
- **File editing** — propose changes to single or multiple files with diff preview before applying
- **Multi-file editing** — edit up to 5 files in one request (e.g., "update README and CHANGELOG to document feature X")
- **Multiple scopes** — index separate directories (e.g. "code" and "notes") and toggle which ones are active per conversation
- **Streaming responses** — LLM output streams token-by-token in real time with progress indicators
- **Fully local** — no cloud APIs, no telemetry, no accounts

---

## Stack

| Layer | Technology |
|---|---|
| LLM & embeddings | [Ollama](https://ollama.com) (local) |
| RAG / vector store | [LlamaIndex](https://www.llamaindex.ai) + [ChromaDB](https://www.trychroma.com) |
| Backend | Python 3.11, FastAPI, uvicorn |
| Frontend | React 19, TypeScript, Vite |
| Dev environment | Nix shell (`shell.nix`) |

---

## Prerequisites

- [Nix](https://nixos.org/download) (NixOS or nix on any Linux distro)
- A GPU or CPU capable of running Ollama models (7B models work well on most modern hardware)

That's it. Everything else — Python, Node, Ollama, dependencies — is managed by `shell.nix`.

---

## Getting started

### 1. Clone the repo

```sh
git clone https://github.com/TheSingularis/shrimp.git
cd shrimp
```

### 2. Configure your watched directories

Copy the example config and edit it:

```sh
cp backend/config.example.py backend/config.py
```

Edit `backend/config.py`:

```python
OLLAMA_MODEL = "qwen2.5-coder:7b"   # any model you have pulled in Ollama
EMBED_MODEL  = "nomic-embed-text"   # embedding model — must be pulled in Ollama

WATCHED_DIRS: list[dict] = [
    {"name": "code",  "path": "~/Documents/my-projects", "enabled": True},
    {"name": "notes", "path": "~/Documents/obsidian",    "enabled": True},
]
```

You can also add, edit, and delete scopes from the UI after starting the app — changes are written back to `config.py` automatically.

### 3. Start the stack

```sh
nix-shell
```

On first run this will:
- Pull `qwen2.5-coder:7b` and `nomic-embed-text` into Ollama (takes a few minutes)
- Create a Python venv and install all backend dependencies
- Install frontend npm packages
- Start Ollama, the FastAPI backend (port 8000), and the Vite dev server

When everything is ready you'll see:

```
┌─────────────────────────────────────────┐
│           SHRIMP* is running            │
│                                         │
│  Ollama   →  http://127.0.0.1:11434     │
│  API      →  http://127.0.0.1:8000      │
│  API docs →  http://127.0.0.1:8000/docs │
│  UI       →  http://localhost:5173      │
└─────────────────────────────────────────┘
```

Open the UI URL in your browser.

### 4. Index your files

Open the ⚙ settings drawer and click **↻** next to a scope to index it, or **↻ index all** to index everything at once. Indexing embeds your files into ChromaDB — this only needs to happen once per scope (or when files change significantly).

---

## Usage

### Chatting

Type a question in the chat box and press **Enter**. The assistant will retrieve relevant chunks from your indexed files and use them as context for its answer.

**Scope pills** in the header control which directories are searched for each message. Click a pill to toggle it on or off for the current conversation.

### Settings drawer (⚙)

| Section | What it does |
|---|---|
| **Model** | Switch between any Ollama models you have installed — takes effect immediately |
| **Scopes** | Add, remove, enable/disable, and re-index directories |

### Adding a scope

In the Settings drawer, fill in a short name and an absolute path (supports `~`) and click **Add**. Then click **↻** to index it.

### Watching logs

```sh
tail -f .ollama/backend.log    # indexing progress, chat requests, errors
tail -f .ollama/serve.log      # Ollama
tail -f .ollama/frontend.log   # Vite
```

---

## Network Access (Mobile/Tablet)

SHRIMP can be accessed from other devices on your local network:

1. Start SHRIMP: `nix-shell`
2. Find your computer's IP address:
   - Linux: `ip addr show | grep "inet "`
   - macOS: `ifconfig | grep "inet "`
3. On your phone/tablet browser, visit: `http://<YOUR_IP>:5173`

**Note:** Your firewall must allow connections on ports 5173 (frontend), 8000 (backend), and 11434 (Ollama).

### Mobile Usage

- The UI is optimized for touch devices and small screens
- Diff viewers appear full-screen on mobile for better usability
- iOS keyboard handling: on-screen keyboard properly adjusts the viewport, keeping all UI elements visible while typing
- Settings drawer scales to screen width
- All buttons meet the 44px touch target minimum for comfortable tapping
- Both portrait and landscape orientations are supported
- **iOS Safari keyboard**: The app properly handles the on-screen keyboard by shrinking the viewport (using the visualViewport API) so all UI elements remain visible when typing

---


## Indexed file types & exclusions

SHRIMP indexes the following extensions:

`.md` `.py` `.ts` `.tsx` `.js` `.jsx` `.json` `.yaml` `.yml` `.toml` `.txt` `.env.example`

**It automatically skips common junk and dependency folders** like `node_modules`, `.git`, `.venv`, `dist`, `build`, `out`, `chroma_db`, and more. This makes indexing large projects fast and avoids embedding thousands of irrelevant files.

---

## Project layout

```
shrimp/
├── backend/
│   ├── main.py          # FastAPI app and all API routes
│   ├── rag.py           # LlamaIndex indexing and querying
│   ├── config.py        # Your local configuration (not committed)
│   └── config.example.py
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── api.ts
│       └── components/
│           ├── ChatPanel.tsx
│           ├── ScopeSelector.tsx
│           └── SettingsDrawer.tsx
└── shell.nix            # Full dev environment
```

---

## Prerequisites

- [Nix](https://nixos.org/download) (NixOS or nix on any Linux distro)
- A GPU or CPU capable of running Ollama models (7B models work well on most modern hardware)

Everything else — Python, Node, Ollama, dependencies — is managed by `shell.nix`.

---

## Getting started

### 1. Clone the repo

```sh
git clone https://github.com/TheSingularis/shrimp.git
cd shrimp
```

### 2. Configure your watched directories

Copy the example config and edit it:

```sh
cp backend/config.example.py backend/config.py
```

Edit `backend/config.py`:

```python
OLLAMA_MODEL = "qwen2.5-coder:7b"   # any model you have pulled in Ollama
EMBED_MODEL  = "nomic-embed-text"   # embedding model — must be pulled in Ollama

WATCHED_DIRS: list[dict] = [
    {"name": "code",  "path": "~/Documents/my-projects", "enabled": True},
    {"name": "notes", "path": "~/Documents/obsidian",    "enabled": True},
]
```

You can also add, edit, and delete scopes from the UI after starting the app — changes are written back to `config.py` automatically.

### 3. Start the stack

For local development we now use `distrobox` for faster, reproducible dev testing on non-NixOS hosts. The repository still includes `shell.nix` for the full environment; you can either run the full `nix-shell` inside a distrobox or use the distrobox workflow shown below.

Example (create + enter a distrobox):

```sh
# create a distrobox (one-time)
distrobox-create --name shrimp --image docker.io/library/ubuntu:22.04

# enter the distrobox
distrobox-enter shrimp

# inside the distrobox you can run the normal dev entrypoint
nix-shell
```

On first run this will:
- Pull Ollama models (`qwen2.5-coder:7b`, `nomic-embed-text`) if not present
- Create a Python venv and install backend dependencies
- Install frontend npm packages
- Start Ollama, the FastAPI backend (port 8000), and the Vite dev server (port 5173)

If you prefer to run `nix-shell` directly on a NixOS machine, the previous workflow is still supported — `shell.nix` manages the same setup.
---

## Dev environment

All services (Ollama, FastAPI backend, Vite frontend) are started automatically by the `shellHook` in `shell.nix`.

- **USE `shell.nix` FOR NIX PACKAGES** — any native library, system tool, or runtime (Python, Node, Ollama) must be declared in the `packages` list in `shell.nix`.
- **Never** run `npm run dev`, `uvicorn`, or `ollama serve` directly — always go through `nix-shell`.
- If a service needs to be restarted, `exit` the shell and re-enter with `nix-shell`.
- `node_modules` must be installed inside the nix-shell. If stale or installed outside the shell, delete it and re-enter.

### Watching logs

```sh
tail -f .ollama/backend.log          # backend only
tail -f .ollama/backend.log .ollama/frontend.log .ollama/serve.log  # everything
```

---

## API routes

| Method   | Path                      | Description                                                   |
| -------- | ------------------------- | ------------------------------------------------------------- |
| `GET`    | `/health`                 | Returns `{ status, model }`                                   |
| `POST`   | `/chat`                   | RAG query + streamed LLM response                             |
| `GET`    | `/scopes`                 | Returns all configured scopes                                 |
| `GET`    | `/settings/scopes`        | Same as `/scopes` (settings context)                          |
| `POST`   | `/settings/scopes`        | Saves full scope list, writes `config.py`                     |
| `DELETE` | `/settings/scopes/{name}` | Removes one scope, writes `config.py`                         |
| `GET`    | `/models`                 | Lists Ollama models + active model                            |
| `POST`   | `/settings/model`         | Sets active model, updates LlamaIndex LLM, writes `config.py` |
| `POST`   | `/index`                  | Triggers background re-index of all enabled scopes            |
| `POST`   | `/index/{name}`           | Triggers background re-index of one scope by name             |
| `GET`    | `/index/status`           | Returns `list[{ name, path, file_count, last_indexed }]`      |

---

## Conventions & best practices

### Backend

- All FastAPI routes are in `main.py`. Business logic lives in `rag.py` (RAG/indexing) and `file_ops.py` (file read/diff/write).
- Python 3.11+ required. Use type hints everywhere. All request/response bodies are Pydantic models.
- Route handlers are `async def`. CPU-bound work is offloaded with `asyncio.run_in_executor`.
- **No file is ever written to disk without going through `file_ops.write_accept()`** — the preview/accept split is a core safety invariant.
- Config is always read from `config.py`, never hardcoded elsewhere.
- All `Path` operations on user-supplied paths must call `.expanduser()`.

### Frontend

- React 19 + TypeScript. Functional components only.
- All backend communication is centralized in `api.ts`. Components never call `fetch` directly.
- Streaming chat uses the Fetch API with a `ReadableStream` reader — do not use a library for this.
- Do not add `any` types without a comment explaining why.

---

## What to avoid

- Do not write files outside of `file_ops.write_accept()`
- Do not make any calls to external APIs or cloud services
- Do not store sensitive data (file contents, paths) in frontend state longer than needed
- Do not use `LangChain` — this project uses `LlamaIndex` for all RAG plumbing
- Do not run `npm run dev`, `uvicorn`, or `ollama serve` directly — always use `nix-shell`

---

## License

MIT

When everything is ready you'll see:

```
┌─────────────────────────────────────────┐
│           SHRIMP* is running            │
│                                         │
│  Ollama   →  http://127.0.0.1:11434     │
│  API      →  http://127.0.0.1:8000      │
│  API docs →  http://127.0.0.1:8000/docs │
│  UI       →  http://localhost:5173      │
└─────────────────────────────────────────┘
```

Open the UI URL in your browser.

### 4. Index your files

Open the ⚙ settings drawer and click **↻** next to a scope to index it, or **↻ index all** to index everything at once. Indexing embeds your files into ChromaDB — this only needs to happen once per scope (or when files change significantly).

---

## Usage

### Chatting

Type a question in the chat box and press **Enter**. The assistant will retrieve relevant chunks from your indexed files and use them as context for its answer.

**Scope pills** in the header control which directories are searched for each message. Click a pill to toggle it on or off for the current conversation.

### Settings drawer (⚙)

| Section | What it does |
|---|---|
| **Model** | Switch between any Ollama models you have installed — takes effect immediately |
| **Scopes** | Add, remove, enable/disable, and re-index directories |

### Adding a scope

In the Settings drawer, fill in a short name and an absolute path (supports `~`) and click **Add**. Then click **↻** to index it.

### Watching logs

```sh
tail -f .ollama/backend.log    # indexing progress, chat requests, errors
tail -f .ollama/serve.log      # Ollama
tail -f .ollama/frontend.log   # Vite
```

---

## Network Access (Mobile/Tablet)

SHRIMP can be accessed from other devices on your local network:

1. Start SHRIMP: `nix-shell`
2. Find your computer's IP address:
   - Linux: `ip addr show | grep "inet "`
   - macOS: `ifconfig | grep "inet "`
3. On your phone/tablet browser, visit: `http://<YOUR_IP>:5173`

**Note:** Your firewall must allow connections on ports 5173 (frontend), 8000 (backend), and 11434 (Ollama).

### Mobile Usage

- The UI is optimized for touch devices and small screens
- Diff viewers appear full-screen on mobile for better usability
- iOS keyboard handling: on-screen keyboard properly adjusts the viewport, keeping all UI elements visible while typing
- Settings drawer scales to screen width
- All buttons meet the 44px touch target minimum for comfortable tapping
- Both portrait and landscape orientations are supported
- **iOS Safari keyboard**: The app properly handles the on-screen keyboard by shrinking the viewport (using the visualViewport API) so all UI elements remain visible when typing

---


## Indexed file types & exclusions

SHRIMP indexes the following extensions:

`.md` `.py` `.ts` `.tsx` `.js` `.jsx` `.json` `.yaml` `.yml` `.toml` `.txt` `.env.example`

**It automatically skips common junk and dependency folders** like `node_modules`, `.git`, `.venv`, `dist`, `build`, `out`, `chroma_db`, and more. This makes indexing large projects fast and avoids embedding thousands of irrelevant files.

---

## Project layout

```
shrimp/
├── backend/
│   ├── main.py          # FastAPI app and all API routes
│   ├── rag.py           # LlamaIndex indexing and querying
│   ├── config.py        # Your local configuration (not committed)
│   └── config.example.py
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── api.ts
│       └── components/
│           ├── ChatPanel.tsx
│           ├── ScopeSelector.tsx
│           └── SettingsDrawer.tsx
└── shell.nix            # Full dev environment
```

---

## Restarting

`nix-shell` manages all three processes. To restart everything cleanly:

```sh
exit        # stops Ollama, backend, and frontend
nix-shell   # starts them all again
```

---

## Troubleshooting

**Backend won't start / `libstdc++.so.6` error**
The `shell.nix` wraps the venv Python to set `LD_LIBRARY_PATH` before any C-extension loads. If you see this error, make sure you're starting via `nix-shell` and not running uvicorn directly.

**Scopes show "not indexed"**
Click **↻** next to the scope in the Settings drawer. Check `.ollama/backend.log` for errors — the most common cause is a path that doesn't exist or contains no supported file types.

**Model list is empty**
Ollama may still be starting up. Check `.ollama/serve.log`. You can also run `ollama list` in a separate terminal to verify models are available.

**Port already in use**
`nix-shell` runs `fuser -k 8000/tcp` and `fuser -k 5173/tcp` on startup to clear stale processes. If you still see the error, run those commands manually before entering the shell.

---

## Recent Updates

#### v0.2.0 (2026-03-20)

- **Markdown Rendering Enhancements**: Added support for `markdown` code fences and improved syntax highlighting.
- **Spinner Improvements**: Fixed animation issues for smoother transitions during streaming.
- **Code Quality**: Addressed type errors and improved component structure for better maintainability.

---
