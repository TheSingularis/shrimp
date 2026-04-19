# Changelog

All notable changes to SHRIMP* will be documented in this file.

---

## Unreleased

### Added

- Electron desktop app packaging via `electron-builder` — produces AppImage and .deb installers on Linux (dmg on macOS, NSIS on Windows)
- `build.sh` script for one-command distribution builds
- `electron/main.js` — Electron main process with packaged-mode support: loads built frontend from `frontend/dist/` via `file://` when packaged, spawns the Python backend from `process.resourcesPath`, and pipes backend/Ollama output to the OS log directory (`app.getPath('logs')`)
- `electron/preload.js` — context bridge exposing window controls and Electron detection to the renderer
- `start-electron.sh` — dev convenience script that builds the frontend, starts Ollama + backend, then launches Electron in dev mode
- Vite `base: './'` when `ELECTRON=1` so all asset URLs are relative and work under `file://`

---

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

---

[v0.1.0]: https://github.com/TheSingularis/shrimp/releases/tag/v0.1.0
