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
