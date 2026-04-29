# SHRIMP Architecture Overview

SHRIMP is a fully self-hosted AI productivity assistant. It runs a local LLM (via Ollama) and connects a React frontend to a Python FastAPI backend. All data is stored on disk — no cloud services, no SQL database. It ships as both a web app (`npm run web`) and a packaged Electron desktop app.

---

## System Components

```mermaid
graph LR
    subgraph Electron ["Electron (desktop only)"]
        EMain["electron/main.js"]
    end

    subgraph Frontend ["Frontend :5173 (dev) / file:// (packaged)"]
        App["App.tsx\n(panel router, state)"]
        Plugins["Plugin UIs\n(email, news, …)"]
        API_TS["api.ts\n(HTTP + SSE client)"]
    end

    subgraph Backend ["FastAPI :8000"]
        Main["main.py\n(routes + startup)"]
        RAG["rag.py\n(LlamaIndex + ChromaDB)"]
        Sched["scheduler.py\n(APScheduler)"]
        PL["plugin_loader.py"]
        TE["tool_executor.py"]
    end

    subgraph Ollama ["Ollama :11434"]
        LLM["Inference\n(OLLAMA_MODEL)"]
        Emb["Embeddings\n(EMBED_MODEL)"]
    end

    subgraph FS ["File System"]
        Convs["conversations/*.json"]
        Notifs["notifications/feed.jsonl"]
        Emails["emails/*.json"]
        Chroma["backend/chroma_db/"]
        Cfg["backend/config.py"]
    end

    subgraph Ext ["External (optional)"]
        IMAP["IMAP server"]
        SMTP["SMTP server"]
        DDG["DuckDuckGo lite"]
    end

    EMain -->|spawns| Backend
    EMain -->|spawns| Ollama
    EMain -->|BrowserWindow| Frontend
    Frontend -->|"HTTP REST + streaming"| Backend
    Backend -->|"httpx /api/chat"| LLM
    RAG -->|"httpx /api/embed"| Emb
    RAG -->|"persist/query"| Chroma
    Main -->|"read/write"| Convs
    Main -->|"read/write"| Notifs
    PL -->|"email plugin"| IMAP
    PL -->|"email plugin"| SMTP
    TE -->|"web_search tool"| DDG
    Backend -->|"read/write"| Cfg
```

---

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| LLM inference | Ollama (local) | configured in `config.py` |
| Embeddings | Ollama `nomic-embed-text` | configured in `config.py` |
| RAG framework | LlamaIndex + ChromaDB | `llama-index-*` packages |
| Backend | Python + FastAPI + uvicorn | Python 3.11+ |
| Background jobs | APScheduler (`BackgroundScheduler`) | |
| Frontend framework | React 19 + TypeScript | |
| Build tool | Vite 8 | |
| CSS | Tailwind CSS 4 + CSS variables | |
| Icons | Lucide React | |
| Code editor (diffs) | Monaco Editor | |
| Desktop shell | Electron 36 | |
| Packaging | electron-builder | AppImage / DMG / NSIS |

---

## Startup Sequence

```mermaid
sequenceDiagram
    participant E as electron/main.js
    participant U as uvicorn process
    participant S as FastAPI startup()
    participant P as projects
    participant R as rag
    participant SC as scheduler
    participant PL as plugin_loader

    E->>U: spawn "python -m uvicorn main:app --port 8000"
    U->>S: @app.on_event("startup")
    S->>P: projects.migrate_to_projects()
    S->>R: rag._hydrate_status()
    Note over R: Reads existing ChromaDB collections<br/>to restore index_status dict after reload
    S->>R: rag.build_all_structural_maps()
    Note over R: Fast filesystem walk — no embeddings
    S->>SC: scheduler.set_main_loop(asyncio.get_event_loop())
    Note over SC: Required so background job threads<br/>can call run_async() safely
    S->>S: register core automations<br/>(obsidian_maintenance, checklist_rollover)
    S->>PL: plugin_loader.register_all_jobs()
    Note over PL: Reads AUTOMATION_CONFIG overrides<br/>from config.py
    S->>SC: scheduler.start()
    S->>PL: plugin_loader.startup_all()
    Note over PL: Calls on_startup() on each plugin<br/>(IMAP IDLE threads, embedding backfill, etc.)
```

**Critical ordering note:** `scheduler.set_main_loop()` must be called before `register_all_jobs()` and `startup_all()`. Background threads that call `scheduler.run_async()` rely on the stored event loop reference. Anything that fires before `set_main_loop()` will raise `RuntimeError`.

---

## On-Disk Storage Layout

SHRIMP uses no SQL database. All persistent state is files.

```mermaid
graph TD
    Root["shrimp/ (repo root)"]

    Root --> Convs["conversations/"]
    Root --> Notifs["notifications/"]
    Root --> Emails["emails/"]
    Root --> BE["backend/"]
    Root --> Plugins["plugins/"]

    Convs --> ConvFile["{uuid}.json\nOne per conversation\n{id, title, messages[], active_path[], project_id}"]
    Convs --> ProjFile["projects.json\nArray of project objects"]

    Notifs --> Feed["feed.jsonl\nAppend-only, one JSON per line\n{id, title, body, type, source, read, priority}"]
    Notifs --> Digest["digest_latest.json\nLatest email digest snapshot"]
    Notifs --> CL["checklist.jsonl\nAppend-only task list"]

    Emails --> EFile["{email_id}.json\nHeaders, body text, HTML, triage metadata"]
    Emails --> Attach["attachments/{email_id}/{filename}"]

    BE --> Chroma["chroma_db/\nChromaDB vector store\n(one collection per scope)"]
    BE --> CfgPy["config.py\nAll settings — Ollama, scopes,\nSMTP/IMAP, RSS feeds, plugin toggles"]
```

---

## The `config.py` Pattern

All settings are stored as Python variable assignments in `backend/config.py`. When the frontend saves a setting, the backend updates the file using regex substitution:

```python
# Example from main.py write_config()
current = re.sub(
    r'OLLAMA_MODEL = ".*?"',
    f'OLLAMA_MODEL = "{model}"',
    current,
)
config_path.write_text(current)
```

**Why:** Single file, human-readable, restart-safe. No separate database or env files needed for a self-hosted tool.

**Caveat:** The regex substitution is fragile if you add comments or unusual whitespace inside config blocks. Keep config values on their own lines and avoid nested comments inside list/dict literals.

`start.sh` copies `config.example.py` → `config.py` on first run if `config.py` doesn't exist.

---

## Electron Packaging Notes

| Mode | Frontend URL | Backend |
|------|-------------|---------|
| Dev (`npm run web`) | `http://localhost:5173` | uvicorn with `--reload` |
| Electron dev (`npm run electron`) | `http://localhost:5173` | separate uvicorn process |
| Packaged | `file:///…/frontend/dist/index.html` | bundled uvicorn, paths resolved via `__dirname` |

The Electron main process (`electron/main.js`) spawns both `ollama serve` and the backend uvicorn as child processes. It resolves the Python binary and backend directory relative to `process.resourcesPath` when packaged, and relative to the repo root in dev.

Vite is built with `ELECTRON=1` for packaged builds, which sets `base: "./"` so all asset URLs are relative (required for `file://` loading).

---

## Development Quick Start

```bash
# Web mode (browser only, fastest for dev)
npm run web
# → starts backend on :8000 and Vite dev server on :5173

# Electron mode (desktop app with window chrome)
npm run electron
# → builds frontend, starts Electron, spawns backend inside it

# Build packaged app
npm run build [-- --linux | --mac | --win]
# → output in dist-electron/
```

First run: `start.sh` will:
1. Check system deps (python3, node, npm, fuser)
2. Create `backend/.venv` and pip-install requirements
3. Copy `config.example.py` → `config.py` if missing
4. Kill stale processes on ports 8000 and 5173
5. Spawn backend and frontend in background, wait for Ctrl+C
