# SHRIMP*

### Self-Hosted RAG Intelligence Model Project

*your files, your model, your rules*

A self-hosted AI assistant that can read, reason about, and propose changes to local files — coding projects and an Obsidian vault — with a VS Code-style diff viewer for reviewing all LLM-proposed edits before they are written to disk.

---

## Goals

- Chat with a local LLM that has full context of your coding projects and Obsidian notes
- Ask it to review, summarize, or update files
- See every proposed file change as a side-by-side diff before accepting or rejecting it
- No cloud, no API keys, no data leaving your machine

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| LLM runtime | [Ollama](https://ollama.com) (bare metal) | Manages model loading; exposes OpenAI-compatible API at `localhost:11434` |
| Embedding model | `nomic-embed-text` via Ollama | Used for RAG indexing |
| Chat model | `qwen2.5-coder:14b` or `llama3.1:8b` | Swap based on VRAM |
| RAG / indexing | [LlamaIndex](https://www.llamaindex.ai) | Handles chunking, embedding, vector retrieval |
| Vector store | [ChromaDB](https://www.trychroma.com) | Runs in-process, no separate service required |
| Backend | [FastAPI](https://fastapi.tiangolo.com) (Python) | Exposes chat, indexing, and file-write endpoints |
| Frontend | Electron or browser-based React | Chat UI + diff viewer |
| Diff viewer | [Monaco Editor](https://microsoft.github.io/monaco-editor/) (same engine as VS Code) | Side-by-side diff with accept/reject per file |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Electron / React UI              │
│                                                     │
│   ┌─────────────────┐    ┌───────────────────────┐  │
│   │   Chat panel    │    │   Diff viewer panel   │  │
│   │  (conversation) │    │  Monaco DiffEditor    │  │
│   └────────┬────────┘    └───────────┬───────────┘  │
│            │  /chat                  │  accept/reject│
└────────────┼─────────────────────────┼──────────────┘
             │                         │
┌────────────▼─────────────────────────▼──────────────┐
│                   FastAPI backend                   │
│                                                     │
│   POST /chat          →  RAG query + LLM response   │
│   POST /write-preview →  returns proposed diff      │
│   POST /write-accept  →  writes file to disk        │
│   POST /index         →  (re)index a directory      │
└──────────┬────────────────────────┬─────────────────┘
           │                        │
  ┌────────▼────────┐     ┌─────────▼──────────┐
  │   LlamaIndex    │     │   Ollama (local)    │
  │   + ChromaDB    │     │   LLM + embeddings  │
  └────────┬────────┘     └─────────────────────┘
           │
  ┌────────▼──────────────────────┐
  │         Local filesystem      │
  │  ~/code/projects  (indexed)   │
  │  ~/obsidian/vault (indexed)   │
  └───────────────────────────────┘
```

---

## Feature Breakdown

### 1. Chat with context (RAG)

The user sends a message. The backend embeds the query, retrieves the top-N relevant file chunks from ChromaDB, injects them as context into the prompt, and streams the LLM response back to the UI.

The user can scope their query to a specific index — code projects, Obsidian vault, or both — via a selector in the UI.

### 2. File change proposals (diff workflow)

When the LLM's response includes a file edit (either explicitly requested or suggested), the backend:

1. Parses the proposed content out of the LLM response
2. Reads the current file from disk
3. Returns both the original and proposed content to the frontend via `POST /write-preview`

The frontend renders them in Monaco's `DiffEditor` component — identical to VS Code's diff view, including inline change highlights and line-level accept/reject controls.

The file is **not written** until the user explicitly clicks Accept. Reject discards the change with no side effects.

### 3. Directory indexing and re-indexing

On first run (or on demand), the backend walks a configured set of directories and indexes all files into ChromaDB. A file watcher (via `watchdog` in Python) detects changes and queues re-indexing automatically so the context stays fresh.

Supported file types out of the box: `.md`, `.py`, `.js`, `.ts`, `.json`, `.yaml`, `.toml`, `.txt`. Easily extensible.

---

## Project Structure

```
shrimp/
├── backend/
│   ├── main.py              # FastAPI app, route definitions
│   ├── rag.py               # LlamaIndex setup, query engine, indexing logic
│   ├── file_ops.py          # Read file, generate diff, write file
│   ├── watcher.py           # watchdog file watcher → triggers re-index
│   └── config.py            # Watched directories, model names, Chroma path
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx
│   │   │   └── DiffViewer.tsx   # Monaco DiffEditor wrapper
│   │   └── api.ts               # Typed fetch wrappers for backend routes
│   └── electron/
│       └── main.js              # Electron shell (optional — runs as web app too)
│
├── docker-compose.yml           # Optional: Chroma as a standalone service
├── requirements.txt
└── README.md
```

---

## Key Implementation Notes

### RAG with LlamaIndex + Ollama

```python
# backend/rag.py
from llama_index.core import VectorStoreIndex, SimpleDirectoryReader, Settings
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.vector_stores.chroma import ChromaVectorStore
import chromadb

Settings.llm = Ollama(model="qwen2.5-coder:14b", request_timeout=120.0)
Settings.embed_model = OllamaEmbedding(model_name="nomic-embed-text")

chroma_client = chromadb.PersistentClient(path="./chroma_db")

def build_index(directory: str, collection_name: str):
    docs = SimpleDirectoryReader(
        directory,
        recursive=True,
        required_exts=[".md", ".py", ".ts", ".js", ".json", ".yaml"]
    ).load_data()
    collection = chroma_client.get_or_create_collection(collection_name)
    vector_store = ChromaVectorStore(chroma_collection=collection)
    return VectorStoreIndex.from_documents(docs, vector_store=vector_store)
```

### Diff preview endpoint

```python
# backend/file_ops.py
import difflib

def generate_diff(original: str, proposed: str) -> dict:
    return {
        "original": original,
        "proposed": proposed,
        # unified diff for reference / future use
        "unified": "\n".join(difflib.unified_diff(
            original.splitlines(),
            proposed.splitlines(),
            lineterm=""
        ))
    }
```

```python
# backend/main.py (route)
@app.post("/write-preview")
async def write_preview(req: WriteRequest):
    original = Path(req.filepath).read_text()
    return generate_diff(original, req.proposed_content)

@app.post("/write-accept")
async def write_accept(req: WriteRequest):
    Path(req.filepath).write_text(req.proposed_content)
    return {"status": "written", "filepath": req.filepath}
```

### Monaco diff viewer (React)

```tsx
// frontend/src/components/DiffViewer.tsx
import { DiffEditor } from "@monaco-editor/react";

export function DiffViewer({ original, modified, onAccept, onReject }) {
  return (
    <div>
      <DiffEditor
        original={original}
        modified={modified}
        height="500px"
        theme="vs-dark"
        options={{ readOnly: true, renderSideBySide: true }}
      />
      <button onClick={onAccept}>Accept</button>
      <button onClick={onReject}>Reject</button>
    </div>
  );
}
```

---

## Build Phases

### Phase 1 — Core chat (est. 1 day)

- Ollama running bare metal with chosen model
- FastAPI backend with `/chat` route hitting Ollama directly (no RAG yet)
- Minimal React chat UI with streaming response support

### Phase 2 — RAG indexing (est. 1–2 days)

- LlamaIndex + ChromaDB wired into the backend
- Index two directories: `~/code` and `~/obsidian/vault`
- `/chat` route now retrieves relevant chunks and injects them as context
- File watcher triggers re-index on save

### Phase 3 — Diff viewer (est. 1 day)

- Backend `/write-preview` and `/write-accept` routes
- Monaco `DiffEditor` component in the frontend
- Chat responses that propose file edits surface a diff panel instead of just text
- Accept writes the file; Reject discards with no changes

### Phase 4 — Polish (est. 1–2 days)

- Index scope selector (code / vault / both)
- Per-file accept/reject when the LLM proposes changes to multiple files at once
- Index status indicator (last indexed, files tracked)
- Electron packaging for a native desktop feel (optional)

---

## Total Estimate

~4–6 days of focused work given existing familiarity with Python, FastAPI, React, and Electron. The RAG and diff layers are the only genuinely new surface area — the rest is plumbing you've done before.
