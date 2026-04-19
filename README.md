# SHRIMP\*

**Self-Hosted RAG Intelligence Model Project**

A local-first AI assistant that knows your files. Point it at your code, notes, or any directory — it indexes everything locally and uses that context when you chat with it. All inference runs on your machine via [Ollama](https://ollama.com). Nothing leaves your network.

---

## What it does

- **Chat with context** — ask questions about your own files and get answers grounded in their actual content
- **Multiple scopes** — index separate directories (e.g. "code" and "notes") and toggle which ones are active per conversation
- **Streaming responses** — LLM output streams token-by-token in real time
- **Fully local** — no cloud APIs, no telemetry, no accounts

---

## Stack

| Layer | Technology |
|---|---|
| LLM & embeddings | [Ollama](https://ollama.com) (local) |
| RAG / vector store | [LlamaIndex](https://www.llamaindex.ai) + [ChromaDB](https://www.trychroma.com) |
| Backend | Python 3.11, FastAPI, uvicorn |
| Frontend | React 19, TypeScript, Vite |
| Desktop app | Electron + electron-builder |
| Dev environment | Arch Linux distrobox (`start.sh`) |

---

## Prerequisites

- [Distrobox](https://github.com/89luca89/distrobox) (on any Linux host) or Arch Linux directly
- A GPU or CPU capable of running Ollama models (7B models work well on most modern hardware)
- Node.js 20+ and npm (for building the Electron app)

The `start.sh` script manages everything else: Python venv, Ollama, npm packages, and all services.

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

**Browser dev mode** (Vite dev server at port 5173):
```sh
distrobox enter arch-dev -- bash start.sh
```

**Electron dev mode** (built frontend, full Electron window):
```sh
distrobox enter arch-dev -- bash start-electron.sh
```

On first run this will:
- Create a Python venv and install all backend dependencies
- Install frontend npm packages
- Pull `qwen2.5-coder:7b` and `nomic-embed-text` into Ollama (takes a few minutes)
- Start Ollama, the FastAPI backend (port 8000), and the UI

When everything is ready the terminal will show a banner with service URLs.

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

### 5. Index your files

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

## Indexed file types

SHRIMP indexes the following extensions:

`.md` `.py` `.ts` `.tsx` `.js` `.jsx` `.json` `.yaml` `.yml` `.toml` `.txt` `.env.example`

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
├── start.sh             # Browser dev mode (Vite + FastAPI + Ollama)
├── start-electron.sh    # Electron dev mode
├── build.sh             # Distribution build (AppImage / deb)
└── package.json         # Root Electron + electron-builder config
```

---

## Restarting

Press `Ctrl+C` in the terminal running `start.sh` or `start-electron.sh` — the cleanup trap kills all child processes cleanly.

---

## Troubleshooting

**Scopes show "not indexed"**
Click **↻** next to the scope in the Settings drawer. Check `.ollama/backend.log` for errors — the most common cause is a path that doesn't exist or contains no supported file types.

**Model list is empty**
Ollama may still be starting up. Check `.ollama/serve.log`. You can also run `ollama list` in a separate terminal to verify models are available.

**Port already in use**
`start.sh` runs `fuser -k` on startup to clear stale processes. If you still see the error, run `fuser -k 8000/tcp 5173/tcp 11434/tcp` manually before starting.

**Electron window is blank (packaged build)**
The frontend must be built with `ELECTRON=1` so Vite uses relative asset paths (`base: './'`). Run `bash build.sh` rather than building manually.
