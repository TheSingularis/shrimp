# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SHRIMP (Self-Hosted RAG Intelligence Model Project) is a local-first AI assistant that indexes your files and uses them as context when answering questions. All inference runs locally via Ollama.

**Stack**: FastAPI backend (Python 3.11) + React 19/TypeScript frontend (Vite) + LlamaIndex/ChromaDB for RAG + Ollama for LLM/embeddings.

## Development Commands

**Start the full stack** (always use this):
```sh
nix-shell
```
This starts Ollama, FastAPI (port 8000), and Vite (port 5173) automatically.

**Watch logs**:
```sh
tail -f .ollama/backend.log          # Backend
tail -f .ollama/serve.log            # Ollama
tail -f .ollama/frontend.log         # Vite
```

**Restart services**: Exit the shell (`exit`) and re-enter (`nix-shell`).

**Never run directly**: `npm run dev`, `uvicorn`, or `ollama serve` — always use `nix-shell`.

## Architecture

### Backend (`backend/`)
- `main.py` — All FastAPI routes. Route handlers are `async def`. CPU-bound work uses `asyncio.run_in_executor`.
- `rag.py` — LlamaIndex indexing and querying logic. Key functions: `build_index()`, `query_scopes()`, `get_structural_summary()`.
- `file_ops.py` — File read/diff/write operations. **All file writes must go through `file_ops.write_accept()`** — this is a safety invariant.
- `config.py` — User configuration (paths, models). Written in-place by the app when settings change.

### Frontend (`frontend/src/`)
- `api.ts` — All backend communication. **Components never call `fetch` directly.**
- `components/ChatPanel.tsx` — Streaming chat UI. Parses `__SHRIMP_EDIT__` sentinels for file edit proposals.
- `components/SettingsDrawer.tsx` — Model/scope management, index controls.
- `components/DiffPanel.tsx` — Monaco diff editor for reviewing proposed file edits.

### Data Flow
1. User message → `POST /chat` with selected scopes
2. Backend runs intent detection + file selection (2 LLM calls)
3. ChromaDB semantic search retrieves relevant chunks
4. System prompt assembled with file tree + chunks + history
5. Ollama streams response tokens to frontend
6. If response contains `__SHRIMP_EDIT__` sentinel → DiffPanel shows proposed changes

## Key Conventions

### Backend
- Type hints everywhere. All request/response bodies are Pydantic models.
- All `Path` operations must call `.expanduser()` — paths may contain `~`.
- Background tasks must have `try/except` with `log.exception(...)`.
- Use `match` statements over long `if/elif` chains.

### Frontend
- Functional components only. React 19 + TypeScript.
- Streaming uses Fetch API `ReadableStream` — no libraries.
- No `any` types without a comment explaining why.

### Dependencies
- Add Python packages to the `pip install` block in `shell.nix`, not by hand.
- Add npm packages with `npm install` inside the nix-shell.
- System libraries go in the `packages` list in `shell.nix`.

## What to Avoid

- Writing files outside of `file_ops.write_accept()`
- External API calls — all LLM/embedding calls go through local Ollama
- Using LangChain — this project uses LlamaIndex
- Running services directly instead of via `nix-shell`
- Storing sensitive data in frontend state longer than needed

## Updating Documentation

**IMPORTANT**: After implementing any feature, fix, or change, proactively update relevant documentation files:

- **README.md** — Update after major changes: new features, changed behavior, updated setup instructions, new dependencies, or modified workflows.
- **CHANGELOG.md** — Add entries under `## Unreleased` section using these categories:
  - `### Added` — New features or capabilities
  - `### Changed` — Changes to existing functionality
  - `### Fixed` — Bug fixes
  - `### Removed` — Removed features or deprecations
  - Use user-facing descriptions (what changed), not implementation details (how it was done).
- **CLAUDE.md** (this file) — Update if you discover new patterns, conventions, or gotchas while working on the codebase.

Always update documentation in the same commit as the code changes, not as a separate step.
