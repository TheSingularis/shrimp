# Changelog

All notable changes to SHRIMP* will be documented in this file.

---

## [Unreleased] — 2026-03-21

### Added

- Dev testing: switched development/test workflow to use `distrobox` for faster iterative testing on non-NixOS distributions. See `README.md` for basic usage notes.
- Frontend: added `DiffPanel` component to render proposed file diffs in the UI (work in progress).

### Changed

- Backend: updated file-reading logic used by the assistant — see `backend/file_ops.py` and `backend/rag.py` for implementation details and new behaviours around path expansion and ignored directories.


## [v0.1.0] — 2025-07-15

### Added

- Local-first AI chat assistant powered by Ollama — all inference stays on your machine
- RAG (Retrieval-Augmented Generation) over local files using LlamaIndex and ChromaDB
- Support for multiple scopes: index separate directories (e.g. code, notes) and toggle which ones are active per conversation
- Scope selector pill-buttons in the header to control which directories are searched for each message
- Settings drawer with model switcher (change the active Ollama model instantly) and full scope management (add, remove, enable/disable, re-index)
- Per-scope and bulk re-index triggers from the settings drawer, with live spinner feedback while indexing runs
- Streaming chat responses — tokens appear in real time as the model generates them
- Index status display showing file count and last-indexed timestamp per scope
- Structured backend logging to `.ollama/backend.log` covering index progress, chat requests, config changes, and errors
- Automatic port clearing on shell start — stale processes on ports 8000 and 5173 are killed before services start
- Full dev environment managed by a single `nix-shell` command — starts Ollama, the backend, and the frontend automatically
- Indexed file types: `.md`, `.py`, `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.yaml`, `.yml`, `.toml`, `.txt`, `.env.example`

- **New:** Indexing now automatically skips common dependency and junk folders (`node_modules`, `.git`, `.venv`, `dist`, `build`, `out`, `chroma_db`, etc.) for much faster indexing of large projects.

---

## [v0.2.0] — 2026-03-20

### Added

- Enhanced markdown rendering in the chat panel, including support for `markdown` code fences that render inner content as markdown.
- Introduced `unwrapOuterMarkdownFence` function to handle unwrapping of markdown fences for cleaner rendering.
- Added custom `code` and `pre` handlers for improved syntax highlighting and fallback rendering.
- Updated the `ChatPanel` component to use a shared `makeComponents` function for consistent markdown rendering.

### Fixed

- Resolved spinner animation issues to ensure smooth transitions during streaming.
- Addressed type errors in the `code` and `pre` handlers by using `React.DetailedHTMLProps` for proper compatibility.
- Fixed cascading renders caused by synchronous state updates in the spinner logic.

---

[v0.1.0]: https://github.com/TheSingularis/shrimp/releases/tag/v0.1.0
[v0.2.0]: https://github.com/TheSingularis/shrimp/releases/tag/v0.2.0
