# SHRIMP*

**Self-Hosted RAG Intelligence Model Project**

> *your files, your model, your rules*

SHRIMP is a local-first AI assistant that indexes your coding projects and Obsidian vault, lets you chat with them via a local LLM, and proposes file edits through a VS Code-style diff viewer — nothing leaves your machine.

---

## Requirements

- [Ollama](https://ollama.com) installed and running (bare metal)
- Python 3.11+
- Node.js 18+

## Quickstart

```bash
# 1. Pull models
ollama pull qwen2.5-coder:14b
ollama pull nomic-embed-text

# 2. Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp config.example.py config.py   # then edit your watched directories
uvicorn main:app --reload

# 3. Frontend
cd frontend
npm install
npm run dev
```

Then open `http://localhost:5173` in your browser, or run `npm run electron` for the desktop app.

---

## How it works

1. **Index** — on first run, SHRIMP walks your configured directories and stores chunked embeddings in a local ChromaDB instance
2. **Chat** — your messages are embedded, matched against your files, and the relevant context is injected into the prompt before hitting Ollama
3. **Edit** — when the LLM proposes a file change, SHRIMP surfaces a diff panel instead of writing directly; you accept or reject each change before anything touches disk

---

## Project structure

```
shrimp/
├── backend/
│   ├── main.py          # FastAPI app + routes
│   ├── rag.py           # LlamaIndex + ChromaDB indexing and query
│   ├── file_ops.py      # Diff generation, file read/write
│   ├── watcher.py       # File watcher → auto re-index on save
│   └── config.py        # Watched dirs, model names, Chroma path
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx
│   │   │   └── DiffViewer.tsx
│   │   └── api.ts
│   └── electron/
│       └── main.js
│
├── .github/
│   └── copilot-instructions.md
├── docker-compose.yml
├── requirements.txt
└── README.md
```

---

## Configuration

Edit `backend/config.py` to point at your directories:

```python
WATCHED_DIRS = {
    "code":    "/home/youruser/code",
    "obsidian": "/home/youruser/obsidian/vault",
}
OLLAMA_MODEL = "qwen2.5-coder:14b"
EMBED_MODEL  = "nomic-embed-text"
CHROMA_PATH  = "./chroma_db"
```

---

## Stack

| Layer | Technology |
|---|---|
| LLM runtime | Ollama (bare metal) |
| Embedding | `nomic-embed-text` via Ollama |
| RAG | LlamaIndex |
| Vector store | ChromaDB (in-process) |
| Backend | FastAPI (Python) |
| Frontend | React + TypeScript |
| Diff viewer | Monaco Editor (`DiffEditor`) |
| Desktop shell | Electron (optional) |

---

## License

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — free to use, modify, and distribute for any purpose, but you must always credit **TheSingularis**.
