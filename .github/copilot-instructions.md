# SHRIMP\* — Copilot Instructions

## General Rules

- **Always update `README.md`** after any major changes (new features, changed behaviour, updated setup steps, new dependencies, etc.).
- **On every release / version tag**, always:
  1. Update `CHANGELOG.md` — add a new `## [vX.Y.Z] — YYYY-MM-DD` block at the top with all changes grouped under `Added`, `Fixed`, `Changed`, `Removed`; add a reference link at the bottom.
  2. **Write changelog entries for end users, not developers.** Describe what the user sees or experiences — never mention internal implementation details (class names, function names, architectural patterns, etc.). Ask: _"would a non-technical user find this meaningful?"_
  3. Commit the changelog before or alongside the tag.
  4. Write a **verbose GitHub release body** that includes every `Added` / `Fixed` / `Changed` / `Removed` item from that version's changelog section — never just a one-liner.

---

## Project overview

SHRIMP (Self-Hosted RAG Intelligence Model Project) is a local-first AI assistant. It indexes your local files and uses them as context when answering questions — all inference runs on your own machine via Ollama. Nothing leaves your network.

The stack has two layers:

- A **FastAPI backend** (Python 3.11) that manages RAG indexing via LlamaIndex + ChromaDB, proxies streaming chat to a local Ollama instance, and handles safe file read/write with diff previews.
- A **React + TypeScript frontend** (Vite, React 19) with a streaming chat panel, scope selector, and a settings drawer for managing scopes, models, and index status.

---

## Repo structure

```
shrimp/
├── backend/
│   ├── main.py          # FastAPI app — all route definitions live here
│   ├── rag.py           # LlamaIndex setup, index builders, query engine
│   ├── config.py        # User-configured paths, model names, Chroma path
│   └── config.py.example  # Template — copy to config.py before first run
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx                    # Root: scope state, header, drawer toggle
│   │   ├── api.ts                     # All fetch calls to the backend
│   │   └── components/
│   │       ├── ChatPanel.tsx          # Streaming chat interface
│   │       ├── ScopeSelector.tsx      # Header pill-buttons for active scopes
│   │       └── SettingsDrawer.tsx     # Model picker, scope management, index controls
│   └── package.json
│
```

---

## Dev environment

All services (Ollama, FastAPI backend, Vite frontend) are started via `start.sh`:

```sh
bash start.sh
```

- **Never** run `npm run dev`, `uvicorn`, or `ollama serve` directly — always use `start.sh`.
- To restart, stop the running processes and re-run the above command.
- Python packages: `pip install`. System packages: `pacman -S`.

`start.sh` handles:
1. Killing anything on ports 8000 and 5173 with `fuser -k` before starting
2. Starting Ollama, FastAPI (port 8000), and Vite (port 5173) as background processes
3. Writing logs to `.ollama/serve.log`, `.ollama/backend.log`, `.ollama/frontend.log`

### Watching logs

```sh
tail -f .ollama/backend.log          # backend only
tail -f .ollama/backend.log .ollama/frontend.log .ollama/serve.log  # everything
```

---

## Backend conventions

- Framework: **FastAPI**. All routes are in `main.py`. Business logic lives in `rag.py` — not inline in route handlers.
- Python version: **3.11+**. Use `match` statements over long `if/elif` chains where appropriate.
- **Type everything.** All function signatures must have type hints. All FastAPI request/response bodies are Pydantic models.
- Route handlers are `async def`. CPU-bound work (indexing, querying) is offloaded with `asyncio.run_in_executor`.
- Background index tasks must have a `try/except` that calls `log.exception(...)` — never swallow errors silently.
- **No file is ever written to disk without going through `file_ops.write_accept()`**. The preview/accept split is a core safety invariant — do not bypass it.
- Config is always read from `config.py`, never hardcoded in other modules.
- All `Path` operations on user-supplied paths must call `.expanduser()` — paths in `config.py` may contain `~`.

### `config.py` shape

```python
OLLAMA_HOST = "http://127.0.0.1:11434"
OLLAMA_MODEL = "qwen2.5-coder:7b"   # active model — mutated at runtime by /settings/model
EMBED_MODEL  = "nomic-embed-text"
CHROMA_PATH  = "./chroma_db"

WATCHED_DIRS: list[dict] = [
    {"name": "code",     "path": "~/...", "enabled": True},
    {"name": "obsidian", "path": "~/...", "enabled": True},
]
```

`config.py` is written in-place by `write_config()` in `main.py` using `re.sub` when the user saves scopes or changes the active model. It is **not** in `.gitignore` by default — it contains local paths.

### `rag.py` — key functions

| Function                                           | Description                                                                                                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build_index(scope: dict) -> dict`                 | Drops and rebuilds the ChromaDB collection for one scope. Expands `~`, checks path exists, loads files matching `SUPPORTED_EXTENSIONS`, embeds, returns status dict. |
| `build_all_indexes() -> list[dict]`                | Iterates all enabled scopes, calls `build_index` on each, catches per-scope errors.                                                                                  |
| `get_index(name: str) -> VectorStoreIndex \| None` | Loads an existing Chroma collection into a LlamaIndex `VectorStoreIndex`. Returns `None` if not yet indexed.                                                         |
| `query_scopes(question, scope_names) -> str`       | Retrieves top-5 chunks from each named scope and returns them as a formatted string for injection into the chat system prompt.                                       |
| `get_status() -> list[dict]`                       | Returns index status for all configured scopes. `last_indexed` is `None` if a scope has never been indexed.                                                          |

**Supported file extensions** (indexed by `SimpleDirectoryReader`):
`.md`, `.py`, `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.yaml`, `.yml`, `.toml`, `.txt`, `.env.example`

**Excluded directories:**
SHRIMP automatically skips common dependency, build, and VCS folders when indexing:
`node_modules`, `.git`, `.venv`, `venv`, `__pycache__`, `.mypy_cache`, `.pytest_cache`, `.ruff_cache`, `.tox`, `dist`, `build`, `out`, `.next`, `.nuxt`, `.svelte-kit`, `target`, `.gradle`, `.idea`, `.vscode`, `chroma_db`, `.ollama`, `coverage`, `.nyc_output`

This prevents accidental embedding of thousands of irrelevant files in large projects.

### Logging

Both `main.py` and `rag.py` use the standard `logging` module with loggers named `shrimp.main` and `shrimp.rag`. Format is `HH:MM:SS [LEVEL] logger: message`. Key events logged:

- LlamaIndex init, ChromaDB ready
- Index start, document count, embedding phase, completion, errors
- Chat requests (scope names + truncated message)
- Config writes (model + scope names)
- Background task exceptions (full traceback via `log.exception`)

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

## Frontend conventions

- Framework: **React 19 + TypeScript**. Functional components only, no class components.
- **All backend communication is centralised in `api.ts`.** Components never call `fetch` directly.
- Streaming chat uses the Fetch API with a `ReadableStream` reader — do not use a library for this.
- Do not add `any` types without a comment explaining why.

### `api.ts` — exported functions

| Function                                      | Returns                       | Notes                                 |
| --------------------------------------------- | ----------------------------- | ------------------------------------- |
| `getScopes()`                                 | `Promise<Scope[]>`            | `GET /scopes`                         |
| `setScopes(scopes)`                           | `Promise<Scope[]>`            | `POST /settings/scopes`               |
| `deleteScope(name)`                           | `Promise<Scope[]>`            | `DELETE /settings/scopes/:name`       |
| `getModels()`                                 | `Promise<{ models, active }>` | `GET /models`                         |
| `setModel(model)`                             | `Promise<void>`               | `POST /settings/model`                |
| `sendChat(message, scopes, history, onToken)` | `Promise<void>`               | Streams tokens via `onToken` callback |
| `getIndexStatus()`                            | `Promise<IndexStatus[]>`      | `GET /index/status`                   |
| `triggerIndexAll()`                           | `Promise<void>`               | `POST /index`                         |
| `triggerIndexOne(name)`                       | `Promise<void>`               | `POST /index/:name`                   |

### Key interfaces

```ts
interface Scope {
  name: string;
  path: string;
  enabled: boolean;
}
interface Message {
  role: "user" | "assistant";
  content: string;
}
interface IndexStatus {
  name: string;
  path: string;
  file_count: number | null;
  last_indexed: string | null;
}
```

### Component map

**`App.tsx`**

- Owns the global `scopes: Scope[]` and `selectedScopes: string[]` state
- Fetches scopes on mount via `getScopes()`; defaults `selectedScopes` to all enabled scopes
- Passes `onScopesChanged` down to `SettingsDrawer` to keep state in sync when the user adds/removes/toggles scopes

**`ChatPanel.tsx`**

- Renders conversation history as `user` / `assistant` messages
- Streams responses from `POST /chat` via `sendChat()` — tokens are appended to the last assistant message in state
- Enter sends, Shift+Enter inserts a newline
- Auto-scrolls to bottom on new content

**`ScopeSelector.tsx`**

- Renders one pill-button per scope in the header
- Disabled if the scope's `enabled` flag is false
- Toggling a pill updates `selectedScopes` in `App` — it does NOT toggle the scope's `enabled` flag, only the active selection for the current chat

**`SettingsDrawer.tsx`**

- Slide-in drawer opened by the ⚙ button
- **Model section**: lists all Ollama models as pill-buttons; clicking one calls `setModel()` immediately
- **Scopes section**: lists all scopes with name, path, index status (file count + time), and three action buttons: re-index (`↻`), enable/disable toggle, delete
- Polling: `handleIndexOne` polls `getIndexStatus()` every 1.5 s until `last_indexed` becomes non-null, then clears the spinner
- Adding a scope appends to the current list and POSTs the full updated list via `setScopes()`

---

## What Copilot should avoid

- Do not suggest writing files outside of `file_ops.write_accept()` — no `open(..., 'w')` calls elsewhere
- Do not suggest making any calls to external APIs or cloud services
- Do not suggest storing sensitive data (file contents, paths) in frontend state longer than needed
- Do not add `any` types in TypeScript without a comment explaining why
- Do not suggest using `LangChain` — this project uses `LlamaIndex` for all RAG plumbing
- Do not suggest running `npm run dev`, `uvicorn`, or `ollama serve` directly — all services must be started via `bash start.sh`
- Install Python packages with `pip install`; system packages with `pacman -S`

SHRIMP (Self-Hosted RAG Intelligence Model Project) is a local-first AI assistant with two layers:

- A **FastAPI backend** (Python) that handles RAG indexing via LlamaIndex + ChromaDB, proxies chat to a local Ollama instance, and manages safe file read/write with diff previews
- A **React + TypeScript frontend** (optionally wrapped in Electron) with a chat panel and a Monaco-based diff viewer for reviewing LLM-proposed file edits

Nothing in this project should make external network calls at runtime. All LLM and embedding inference goes through Ollama at `localhost:11434`.

---

## Repo structure

```
shrimp/
├── backend/
│   ├── main.py        # FastAPI app — all route definitions live here
│   ├── rag.py         # LlamaIndex setup, index builders, query engines
│   ├── file_ops.py    # File read, diff generation, file write
│   ├── watcher.py     # watchdog-based file watcher, triggers re-index
│   └── config.py      # User-configured paths, model names, Chroma path
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx      # Streaming chat interface
│   │   │   └── DiffViewer.tsx     # Monaco DiffEditor with accept/reject
│   │   └── api.ts                 # All fetch calls to the backend
│   └── electron/
│       └── main.js                # Electron entry point (optional)
│
└── .github/
    └── copilot-instructions.md    # This file
```

---

## Backend conventions

- Framework: **FastAPI**. All routes are in `main.py`. Business logic lives in the relevant module (`rag.py`, `file_ops.py`), not inline in route handlers.
- Python version: **3.11+**. Use `match` statements over long `if/elif` chains where appropriate.
- Type everything. All function signatures must have type hints. All FastAPI request/response bodies are Pydantic models.
- Async where it matters: route handlers should be `async def`. CPU-bound work (indexing) should be offloaded with `asyncio.run_in_executor`.
- No file is ever written to disk without going through `file_ops.write_accept()`. The preview/accept split is a core safety invariant — do not bypass it.
- Config is always read from `config.py`, never hardcoded in other modules.

### Key modules

**`rag.py`**

- Uses LlamaIndex with Ollama as both the LLM and embedding provider
- Maintains one ChromaDB collection per indexed directory (e.g. `"code"`, `"obsidian"`)
- `build_index(directory, collection_name)` — full index build
- `query(question, collection_name)` — retrieves top-N chunks and returns them as context strings
- `get_query_engine(collection_name)` — returns a LlamaIndex query engine for a given collection

**`file_ops.py`**

- `read_file(filepath)` → `str`
- `generate_diff(original, proposed)` → `dict` with `original`, `proposed`, and `unified` keys
- `write_accept(filepath, content)` → writes content to disk, returns confirmation
- `write_accept(filepath, content)` → writes content to disk, returns confirmation

Note: The backend file-reading logic has recently been updated. If you are modifying or debugging file ingestion, previewing, or diff generation, review `backend/file_ops.py` and `backend/rag.py` for the latest semantics around path expansion, ignored directories, and unified diff generation.

**`watcher.py`**

- Uses `watchdog` to watch all directories in `config.WATCHED_DIRS`
- On file change, queues a re-index for the affected collection
- Debounce re-index calls — don't re-index on every keystroke, wait for a settle period (~2s)

---

## Frontend conventions

- Framework: **React 18 + TypeScript**. Functional components only, no class components.
- All backend communication is centralized in `api.ts`. Components never call `fetch` directly.
- Streaming chat responses use the Fetch API with a `ReadableStream` reader — do not use a library for this.
- The diff viewer must never allow edits to the proposed content — Monaco `DiffEditor` should always be `readOnly: true`. The only actions are Accept and Reject.
- When the LLM response contains multiple file proposals, render one `DiffViewer` per file. Each has independent accept/reject state.

Note: A new `DiffPanel` / `DiffViewer` component was recently added to the frontend to render proposed file edits. It's functional but still a work in progress — expect further UX and styling refinements.

- Electron shell is optional — the app must work as a plain browser tab at `localhost:5173` without Electron.

### Key components

**`ChatPanel.tsx`**

- Renders conversation history
- Streams responses from `POST /chat`
- When the backend signals a file proposal in the response, switches to showing the `DiffViewer` alongside the message

**`DiffViewer.tsx`**

- Wraps `@monaco-editor/react`'s `DiffEditor`
- Props: `original: string`, `modified: string`, `filepath: string`, `onAccept: () => void`, `onReject: () => void`
- On Accept: calls `api.writeAccept(filepath, modified)`, then calls `onAccept()`
- On Reject: calls `onReject()` only — no backend call needed

**`api.ts`**

- `chat(message, scope)` — `scope` is `"code" | "obsidian" | "both"`
- `writePreview(filepath, proposedContent)` — returns `{ original, proposed, unified }`
- `writeAccept(filepath, content)` — fires and returns confirmation
- `triggerIndex(directory)` — manually re-triggers indexing

---

## API routes

| Method | Path             | Description                                             |
| ------ | ---------------- | ------------------------------------------------------- |
| `POST` | `/chat`          | RAG query + streamed LLM response                       |
| `POST` | `/write-preview` | Returns diff of original vs proposed content            |
| `POST` | `/write-accept`  | Writes proposed content to disk                         |
| `POST` | `/index`         | Triggers a full re-index of a directory                 |
| `GET`  | `/index/status`  | Returns last-indexed time and file count per collection |

---

## Dev environment

All services (Ollama, FastAPI backend, Vite frontend) are started via `start.sh`:

```sh
bash start.sh
```

- **Never** run `npm run dev`, `uvicorn`, or `ollama serve` directly — always use `start.sh`.
- To restart, stop the running processes and re-run the above command.
- Install Python packages with `pip install`; system packages with `pacman -S`.

---

## What Copilot should avoid

- Do not suggest writing files outside of `file_ops.write_accept()` — no `open(..., 'w')` calls elsewhere
- Do not suggest making any calls to external APIs or cloud services
- Do not suggest storing sensitive data (file contents, paths) in frontend state longer than needed for the current diff review
- Do not add `any` types in TypeScript without a comment explaining why
- Do not suggest using `LangChain` — this project uses `LlamaIndex` for all RAG plumbing
- Do not suggest running `npm run dev`, `uvicorn`, or `ollama serve` directly — all services must be started via `bash start.sh`
