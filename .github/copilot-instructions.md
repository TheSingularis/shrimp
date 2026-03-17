# SHRIMP* — Copilot Instructions

## Project overview

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

| Method | Path | Description |
|---|---|---|
| `POST` | `/chat` | RAG query + streamed LLM response |
| `POST` | `/write-preview` | Returns diff of original vs proposed content |
| `POST` | `/write-accept` | Writes proposed content to disk |
| `POST` | `/index` | Triggers a full re-index of a directory |
| `GET` | `/index/status` | Returns last-indexed time and file count per collection |

---

## What Copilot should avoid

- Do not suggest writing files outside of `file_ops.write_accept()` — no `open(..., 'w')` calls elsewhere
- Do not suggest making any calls to external APIs or cloud services
- Do not suggest storing sensitive data (file contents, paths) in frontend state longer than needed for the current diff review
- Do not add `any` types in TypeScript without a comment explaining why
- Do not suggest using `LangChain` — this project uses `LlamaIndex` for all RAG plumbing
