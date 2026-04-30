# SHRIMP\*

**Self-Hosted RAG Intelligence Model Project**

A local-first AI assistant that knows your files. Point it at your code, notes, or any directory — it indexes everything locally and uses that context when you chat with it. All inference runs on your machine via [Ollama](https://ollama.com). Nothing leaves your network.

---

## What it does

- **Chat with context** — ask questions about your own files and get answers grounded in their actual content
- **File editing** — propose changes to single or multiple files with diff preview before applying
- **Multi-file editing** — edit up to 5 files in one request (e.g., "update README and CHANGELOG to document feature X")
- **Project organization** — group related conversations into projects with custom names and colors
- **Multiple scopes** — index separate directories (e.g. "code" and "notes") and toggle which ones are active per conversation
- **Streaming responses** — LLM output streams token-by-token in real time with progress indicators
- **Fully local** — no cloud APIs, no telemetry, no accounts

---

## Stack

| Layer | Technology |
|---|---|
| LLM & embeddings | [Ollama](https://ollama.com) (external, default: `localhost:11434`) |
| RAG / vector store | [LlamaIndex](https://www.llamaindex.ai) + [ChromaDB](https://www.trychroma.com) |
| Backend | Python 3.11, FastAPI, uvicorn |
| Frontend | React 19, TypeScript, Vite |
| Dev environment | Arch Linux + `start.sh` |

---

## Recommended Models

SHRIMP works with any Ollama model. Two good starting points:

| Use case | Model | Notes |
|---|---|---|
| **General use** | `qwen2.5:7b` | Good reasoning, fast, fits in ~8GB VRAM or ~8GB RAM |
| **Code-focused** | `qwen2.5-coder:7b` | Specialized for code generation, editing, and analysis |

**Embeddings (required):** `nomic-embed-text` — pull this in Ollama before indexing. It handles all semantic search and runs alongside the main model.

Any model that supports function calling (llama3.1+, qwen2.5+) will work well. Older models automatically fall back to prompt-chaining mode.

---

## Prerequisites

- [Ollama](https://ollama.com) running and accessible (default: `localhost:11434`)
- Node.js 20+ and npm (for building the Electron app)

---

## Getting started

### 1. Clone the repo

```sh
git clone https://github.com/TheSingularis/shrimp.git
cd shrimp
```

### 2. Start the stack

```sh
bash start.sh
```

On first run this will:
- Create a Python venv and install all backend dependencies
- Install frontend npm packages
- Start the FastAPI backend (port 8000) and Vite dev server (port 5173)

> **Note:** SHRIMP does not manage Ollama. Make sure Ollama is already running before starting (`ollama serve` or via your system service). Models must be pulled separately: `ollama pull qwen2.5-coder:7b && ollama pull nomic-embed-text`.

When everything is ready the terminal will show:

```
┌─────────────────────────────────────────┐
│           SHRIMP* is running            │
│                                         │
│  API      →  http://127.0.0.1:8000      │
│  API docs →  http://127.0.0.1:8000/docs │
│  UI       →  http://localhost:5173      │
└─────────────────────────────────────────┘
```

Open the UI URL in your browser.

### 3. Index your files

Open the ⚙ settings drawer and click **↻** next to a scope to index it, or **↻ index all** to index everything at once. Indexing embeds your files into ChromaDB — this only needs to happen once per scope (or when files change significantly).

### 4. Build for distribution (optional)

To produce a distributable AppImage / .deb:

```sh
# Install root-level Electron deps first (only needed once)
npm install

# Build everything and package
bash build.sh
```

Output lands in `dist-electron/`. Pass `--mac` or `--win` to target other platforms.

> **Note on Python bundling**: `electron-builder` copies `backend/` and `backend/.venv/` into the app as extra resources. The bundled `.venv` must be built on the same OS and architecture as the target machine. Cross-compiling Python extensions is not supported.

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
tail -f .ollama/frontend.log   # Vite
```

---

## Network Access (Mobile/Tablet)

SHRIMP can be accessed from other devices on your local network:

1. Start SHRIMP: `bash start.sh`
2. Find your computer's IP address: `ip addr show | grep "inet "`
3. On your phone/tablet browser, visit: `http://<YOUR_IP>:5173`

**Note:** Your firewall must allow connections on ports 5173 (frontend) and 8000 (backend).

### Ollama host

SHRIMP connects to an existing Ollama instance — it does not manage Ollama itself. The default host is `localhost:11434`.

To change the host, go to Settings (⚙) → **OLLAMA HOST**, enter the IP:port (e.g., `192.168.1.100:11434`), and click **Save**. SHRIMP validates the connection before saving.

If Ollama is on a different machine, start it with network binding so it accepts remote connections:

```sh
OLLAMA_HOST=0.0.0.0:11434 ollama serve
```

### Mobile

- The UI is optimized for touch devices and small screens
- Diff viewers appear full-screen on mobile
- iOS/Android on-screen keyboard adjusts the viewport so all UI elements stay visible while typing
- Settings drawer, tab bar, and scope selector scale to screen width
- All buttons meet the 44px touch target minimum
- Both portrait and landscape orientations are supported

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
├── electron/
│   ├── main.js          # Electron main process (dev + packaged mode)
│   └── preload.js       # Context bridge for window controls
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── api.ts
│       └── components/
│           ├── ChatPanel.tsx
│           ├── ScopeSelector.tsx
│           └── SettingsDrawer.tsx
```

---

## Dev environment

The FastAPI backend and Vite frontend are started via `start.sh`:

```sh
bash start.sh
```

- **Never** run `npm run dev` or `uvicorn` directly — always use `start.sh`.
- To restart, stop the running processes and re-run the above command.
- Install Python packages with `pip install`; system packages with `pacman -S`.

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

## Conventions

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
- Do not run `npm run dev` or `uvicorn` directly — always use `start.sh`

---

## Troubleshooting

**Backend won't start**
Make sure you're running via `bash start.sh` and not invoking uvicorn directly.

**Scopes show "not indexed"**
Click **↻** next to the scope in the Settings drawer. Check `.ollama/backend.log` for errors — the most common cause is a path that doesn't exist or contains no supported file types.

**Model list is empty**
Make sure Ollama is running and reachable at the configured host (default: `localhost:11434`). Run `ollama list` to verify models are available, or check Settings (⚙) → **OLLAMA HOST** if you're using a non-default address.

**Port already in use**
Run `fuser -k 8000/tcp` and `fuser -k 5173/tcp` to clear stale processes, then re-run the start command.

---

## License

MIT
