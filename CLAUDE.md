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
- `components/ChatPanel.tsx` — Streaming chat UI. Parses `__SHRIMP_EDIT__`, `__SHRIMP_MULTI_EDIT__`, and `__STAGE_HISTORY__` sentinels. Handles live stage indicators during streaming and persistent stage markers after completion.
- `components/DiffPanel.tsx` — Monaco diff editor for single-file edit review.
- `components/MultiFileDiffPanel.tsx` — Tabbed Monaco diff viewer for multi-file edits with per-file approve/reject.
- `components/SettingsDrawer.tsx` — Model/scope management, index controls.

### Data Flow

**Intent Detection (3-way)**:
1. User message → `POST /chat` with selected scopes
2. Backend runs intent detection (1 LLM call) → `"question" | "single_file_edit" | "multi_file_edit"`
3. File selection (1 LLM call) → identifies which files to read
4. ChromaDB semantic search retrieves relevant chunks

**Question Mode**:
5. System prompt assembled with file tree + chunks + history
6. Ollama streams response tokens to frontend

**Single-File Edit Mode**:
5. Load full file content
6. Generate edit with section extraction
7. Stream response with `__SHRIMP_EDIT__` sentinel
8. DiffPanel shows proposed change

**Multi-File Edit Mode**:
5. Load all file contents (up to 5 files)
6. For each file: generate edit sequentially (N LLM calls)
7. Stream response with stage tokens + `__SHRIMP_MULTI_EDIT__` sentinel
8. MultiFileDiffPanel shows tabbed diffs with approve/reject controls
9. User approves subset → batch apply

**Stage Indicators & Markers**:
- **Live indicators**: During streaming, `__STAGE__<name>` tokens update the spinner label (e.g., "Searching...", "Reading file..."). These show what's happening right now.
- **Persistent markers**: After response completes, `__STAGE_HISTORY__` sentinel contains the full execution trace. Frontend renders greyed-out markers like "[Searched files • 3 calls]" in conversation history.
- **Implementation**: Backend tracks all content output and tool executions in `stage_history` list. Frontend parses `__STAGE_HISTORY__` sentinel and interleaves markers between content chunks.

## Key Conventions

### General Principles
- **Avoid code duplication**: Before implementing new functionality, check if similar code already exists that can be reused or abstracted. Extract common logic into shared functions rather than duplicating patterns.
- **Prefer composition over duplication**: If two functions need similar behavior, have one call the other or extract shared logic into a helper function.

### Backend
- Type hints everywhere. All request/response bodies are Pydantic models.
- All `Path` operations must call `.expanduser()` — paths may contain `~`.
- Background tasks must have `try/except` with `log.exception(...)`.
- Use `match` statements over long `if/elif` chains.

### Frontend
- Functional components only. React 19 + TypeScript.
- Streaming uses Fetch API `ReadableStream` — no libraries.
- No `any` types without a comment explaining why.
- **iOS keyboard handling**: Use the `useVisualViewport` hook (in `frontend/src/hooks/useVisualViewport.ts`) for mobile keyboard support. Apply it at the app container level with `position: fixed` and let the hook dynamically adjust height. Key requirements:
  - Apply hook to top-level container with `position: fixed, left: 0, right: 0, top: 0`
  - Use `min-h-0` on scrollable content areas (critical for flexbox scrolling)
  - Use `shrink-0` on fixed elements (header, input) to prevent compression
  - Add `overflow: hidden` and `overscroll-behavior: none` to html/body in global CSS

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
