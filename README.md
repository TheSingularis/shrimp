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
| LLM & embeddings | [Ollama](https://ollama.com) (local) |
| RAG / vector store | [LlamaIndex](https://www.llamaindex.ai) + [ChromaDB](https://www.trychroma.com) |
| Backend | Python 3.11, FastAPI, uvicorn |
| Frontend | React 19, TypeScript, Vite |
| Dev environment | Arch distrobox (`distrobox enter arch-dev -- bash start.sh`) |

---

## Recommended Models

SHRIMP works with any Ollama model. Choose based on your hardware:

### CPU Only (No GPU / Low VRAM)

Perfect for laptops and systems without dedicated GPUs (like Framework 13). Ollama automatically uses CPU when no GPU is available.

**Best for CPU:**
- **llama3.1:8b** - Excellent balance ⭐ (Recommended for CPU)
  - RAM: ~8-10GB | Download: ~5GB
  - Good tool calling support
  - Reasonable speed on modern CPUs (~10-20s per response)
  - Reduce context to 4096 for better performance

- **qwen2.5:7b** - Solid alternative
  - RAM: ~7-9GB | Download: ~4.7GB
  - Good quality responses
  - Slightly faster than 8B models

**Fast & Light (for slower CPUs):**
- **phi3.5:3.8b** - Very fast responses
  - RAM: ~4-5GB | Download: ~2.3GB
  - Great for quick questions
  - Lower quality but 3-5x faster

- **qwen2.5:3b** - Compact option
  - RAM: ~3-4GB | Download: ~2GB
  - Good for basic tasks

```python
# backend/config.py (CPU-optimized)
OLLAMA_MODEL = "llama3.1:8b"
NUM_CTX = 4096  # Lower context = faster inference
USE_TOOL_CALLING = True
```

**Performance Tips for CPU:**
- Use models ≤8B parameters
- Reduce `NUM_CTX` to 4096 (Settings → Context Window)
- Close other heavy applications during inference
- Expect 10-30s response times vs 2-5s on GPU

---

### 8GB VRAM (Entry Level GPU)

**Tool Calling:**
- **llama3.1:8b** - Best balance of speed and capability
  - VRAM: ~6-8GB | Download: ~5GB
  - 100% tool calling success rate in testing
  - Fast responses (avg 4-5s per request)

**Code-Focused:**
- **qwen2.5-coder:7b** - Excellent for code tasks
  - VRAM: ~6-8GB | Download: ~4.7GB
  - Strong code completion and refactoring

```python
# backend/config.py
OLLAMA_MODEL = "llama3.1:8b"
USE_TOOL_CALLING = True  # Default: enabled
```

### 16GB VRAM (Your GPU: Radeon RX 9060 XT)

**Tool Calling:**
- **qwen2.5:14b** ⭐ (Recommended for 16GB)
  - VRAM: ~10-12GB | Download: ~9GB
  - Superior reasoning and code understanding
  - Comfortable fit with headroom
  - Excellent tool calling support

**Code-Focused:**
- **qwen2.5-coder:14b** - Best for code-heavy workloads
  - VRAM: ~10-12GB | Download: ~9GB
  - Specialized for code generation and analysis

**Alternative:**
- **mistral-nemo:12b** - Good general-purpose option
  - VRAM: ~8-10GB | Download: ~7GB
  - Lighter, faster inference

```python
# backend/config.py
OLLAMA_MODEL = "qwen2.5:14b"
USE_TOOL_CALLING = True
NUM_CTX = 16384  # Full context window fits comfortably
```

### 24GB+ VRAM (High-End)

**Premium Options:**
- **qwen2.5:32b** - Excellent quality
  - VRAM: ~22-24GB | Download: ~20GB
  - Very strong reasoning

- **llama3.3:70b** - Highest quality (requires 40GB+)
  - VRAM: ~40-42GB | Download: ~40GB
  - Best-in-class reasoning (Q4 quantization)

### 4GB VRAM (Limited)

- **llama3.2:3b** - Minimal option
  - VRAM: ~3-4GB | Download: ~2GB
  - Good for simple queries only

### Embeddings (Required)

**All VRAM tiers:**
- **nomic-embed-text** ⭐ (Required for semantic search)
  - VRAM: ~2GB | Download: ~274MB
  - Runs alongside main model

```python
# backend/config.py
EMBED_MODEL = "nomic-embed-text"
```

### Quick Reference Table

| Model | VRAM Usage | Download Size | Best For | Tool Calling |
|-------|-----------|---------------|----------|--------------|
| llama3.2:3b | 3-4GB | 2GB | Budget builds | ✅ |
| llama3.1:8b | 6-8GB | 5GB | 8GB GPUs | ✅ Excellent |
| qwen2.5-coder:7b | 6-8GB | 4.7GB | Code (8GB) | ✅ |
| mistral-nemo:12b | 8-10GB | 7GB | General (16GB) | ⚠️ Limited |
| **qwen2.5:14b** ⭐ | **10-12GB** | **9GB** | **16GB GPUs** | ✅ **Excellent** |
| **qwen2.5-coder:14b** | **10-12GB** | **9GB** | **Code (16GB)** | ✅ **Excellent** |
| qwen2.5:32b | 22-24GB | 20GB | 24GB+ GPUs | ✅ Excellent |
| llama3.3:70b | 40-42GB | 40GB | 40GB+ GPUs | ✅ Best |

**Note:** Tool calling requires models that support function calling (llama3.1+, qwen2.5+). Older models automatically fall back to prompt-chaining mode.

---

## Prerequisites

- [distrobox](https://github.com/89luca89/distrobox) with an Arch Linux container named `arch-dev`
- A GPU or CPU capable of running Ollama models (7B models work well on most modern hardware)

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
distrobox enter arch-dev -- bash start.sh
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

1. Start SHRIMP: `distrobox enter arch-dev -- bash start.sh`
2. Find your computer's IP address: `ip addr show | grep "inet "`
3. On your phone/tablet browser, visit: `http://<YOUR_IP>:5173`

**Note:** Your firewall must allow connections on ports 5173 (frontend), 8000 (backend), and 11434 (Ollama).

### External Ollama

To connect SHRIMP to an Ollama instance running on a different machine:

1. On the Ollama host, start Ollama with network binding:
   ```sh
   OLLAMA_HOST=0.0.0.0:11434 ollama serve
   ```

2. In SHRIMP Settings (⚙) → **OLLAMA HOST**:
   - Select "External (Custom)"
   - Enter the IP:port of the Ollama host (e.g., `192.168.1.100:11434`)
   - Click **Save**

SHRIMP will validate the connection before saving. This enables using SHRIMP with remote/networked Ollama servers (e.g., a GPU-enabled machine running Ollama while you use SHRIMP on a laptop).

### Mobile Usage

- The UI is optimized for touch devices and small screens
- Diff viewers appear full-screen on mobile for better usability
- iOS keyboard handling: on-screen keyboard properly adjusts the viewport, keeping all UI elements visible while typing
- Settings drawer scales to screen width
- All buttons meet the 44px touch target minimum for comfortable tapping
- Both portrait and landscape orientations are supported
- Tab bar and scope selector horizontally scrollable to prevent overflow
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
```

---

## Dev environment

All services (Ollama, FastAPI backend, Vite frontend) are started via `start.sh` inside the Arch distrobox:

```sh
distrobox enter arch-dev -- bash start.sh
```

- **Never** run `npm run dev`, `uvicorn`, or `ollama serve` directly — always use `start.sh` via the distrobox.
- To restart, stop the running processes and re-run the above command.
- Install Python packages with `pip install` inside the distrobox; system packages with `pacman -S`.

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
- Do not run `npm run dev`, `uvicorn`, or `ollama serve` directly — always use `start.sh` via the distrobox

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

1. Start SHRIMP: `distrobox enter arch-dev -- bash start.sh`
2. Find your computer's IP address: `ip addr show | grep "inet "`
3. On your phone/tablet browser, visit: `http://<YOUR_IP>:5173`

**Note:** Your firewall must allow connections on ports 5173 (frontend), 8000 (backend), and 11434 (Ollama).

### External Ollama

To connect SHRIMP to an Ollama instance running on a different machine:

1. On the Ollama host, start Ollama with network binding:
   ```sh
   OLLAMA_HOST=0.0.0.0:11434 ollama serve
   ```

2. In SHRIMP Settings (⚙) → **OLLAMA HOST**:
   - Select "External (Custom)"
   - Enter the IP:port of the Ollama host (e.g., `192.168.1.100:11434`)
   - Click **Save**

SHRIMP will validate the connection before saving. This enables using SHRIMP with remote/networked Ollama servers (e.g., a GPU-enabled machine running Ollama while you use SHRIMP on a laptop).

### Mobile Usage

- The UI is optimized for touch devices and small screens
- Diff viewers appear full-screen on mobile for better usability
- iOS keyboard handling: on-screen keyboard properly adjusts the viewport, keeping all UI elements visible while typing
- Settings drawer scales to screen width
- All buttons meet the 44px touch target minimum for comfortable tapping
- Both portrait and landscape orientations are supported
- Tab bar and scope selector horizontally scrollable to prevent overflow
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
```

---

## Restarting

Stop the running processes and re-run the start command:

```sh
distrobox enter arch-dev -- bash start.sh
```

---

## Troubleshooting

**Backend won't start**
Make sure you're running via `distrobox enter arch-dev -- bash start.sh` and not invoking uvicorn directly.

**Scopes show "not indexed"**
Click **↻** next to the scope in the Settings drawer. Check `.ollama/backend.log` for errors — the most common cause is a path that doesn't exist or contains no supported file types.

**Model list is empty**
Ollama may still be starting up. Check `.ollama/serve.log`. You can also run `ollama list` in a separate terminal to verify models are available.

**Port already in use**
Run `fuser -k 8000/tcp` and `fuser -k 5173/tcp` manually to clear stale processes, then re-run the start command.

---

## Recent Updates

#### v0.2.0 (2026-03-20)

- **Markdown Rendering Enhancements**: Added support for `markdown` code fences and improved syntax highlighting.
- **Spinner Improvements**: Fixed animation issues for smoother transitions during streaming.
- **Code Quality**: Addressed type errors and improved component structure for better maintainability.

---
