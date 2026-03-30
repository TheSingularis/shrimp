# SHRIMP* — TODO

Reordered by impact and strategic value. Frontloaded with high-value features that enable future work or significantly improve UX.

---

## 🎯 Tier 1: High Impact, Medium Effort (RECOMMENDED NEXT)

- [x] **Additional prompt instructions in settings** — Freetext field in settings that appends custom instructions to the system prompt. Huge flexibility gain for tuning SHRIMP's tone, focus, or domain knowledge per project without touching code. Persist to `config.py`.
  - **COMPLETED:** Global custom instructions + per-scope descriptions + auto-generate descriptions using LLM

- [x] **Save conversations** — Persist chat history to JSON files on disk (one file per conversation). Auto-save after each exchange.
  - **COMPLETED:** Full conversation history system with sidebar, load/save, delete, rename, auto-save

- [x] **Retry prompt button** — Similar to ChatGPT/Claude, a button to regenerate the last assistant response. Common UX pattern users expect.
  - **COMPLETED:** Retry button appears on last assistant message, regenerates response with same user input

---

## 🏗️ Tier 2: Strategic Enablers (build on Tier 1)

- [x] **Multiple conversation tabs** — Extend saved conversations to support multiple named tabs open simultaneously in the UI. Enables parallel work on different topics/files.
  - **COMPLETED:** Browser-style tabs with separate state per tab, smart loading, auto-save on switch, and title auto-update

- [x] **Conversation Projects** — Group related conversations into projects for better organization.
  - **COMPLETED:** Project creation/deletion, drag-and-drop to move conversations, collapsible folders, color-coded indicators
  - **COMPLETED:** Project settings modal (edit name, description, color, default scopes, custom instructions)
  - **COMPLETED:** Per-project default scopes (auto-select for new conversations)
  - **COMPLETED:** Per-project custom instructions (appended to system prompt)
  - **Future enhancements:**
    - [ ] Project templates for quick setup
    - [ ] Project statistics (conversation count, last activity, total messages)

---

## 🎨 Tier 3: Polish & Accessibility

- [ ] **Update Branding** — Update styling to use shrimp icons (`frontend/public/icons`) and cohesive color scheme. Maybe add theme options in settings. Update ALL Icons to use a cohesive design.
  - Rework settings page to utilize more screen space (possibly full window instead of drawer)
  - Create a cohesive Styling Guide document defining colors, spacing, typography, component patterns
  - **Why now:** Visual polish improves perceived quality. Quick win.

- [ ] **Mobile-responsive CSS** — Make layout work on small screens for phone/tablet access.
  - **Pairs with:** Ollama host settings (network access)

- [ ] **Ollama host settings** — Radio toggle between local (managed by SHRIMP) and external (user-supplied URL). Persist to `config.py`.
  - **Enables:** Network access from other devices
  - **Related:** Fix loopback binding (`0.0.0.0` instead of `127.0.0.1`)

---

## 🔮 Tier 4: Advanced Features (future)

- [ ] **Fork conversations** — Branch a conversation from any point in history into a new tab. Requires tree structure instead of flat array.
  - **Prerequisite:** Multiple conversation tabs

- [ ] **Electron app** — Package as desktop app with bundled Python backend and optional bundled Ollama.
  - **Why later:** Significant packaging effort. Current web app works well.

- [ ] **Tool calling phase 2** — Once tool calling refactor is stable, add:
  - Web search tool
  - Shell command execution tool
  - File system operations (create, delete, move)

---

## 💡 Nice to Have / Lower Priority

- [ ] **Hardware-based performance estimation** — Detect user's system specs (CPU cores/speed, RAM, GPU VRAM) and provide personalized model recommendations based on actual hardware capabilities.
  - Auto-detect hardware on backend startup (CPU info, available RAM, GPU detection via Ollama)
  - Calculate estimated inference speed per model based on detected hardware
  - Update model badges dynamically: same model might be green (CPU OK) on powerful CPU but yellow (GPU recommended) on weak CPU
  - Show estimated tokens/second or response time in model selector
  - **Builds on:** Current static model size badges (already implemented)
  - **Value:** Personalized guidance instead of generic recommendations
- [ ] **GPU utilization indicator** — Live GPU memory usage in header, polling `ollama ps`. Calculate predicted VRAM usage for context window.
- [ ] **Per-scope prompt context** — Optional description per scope injected into system prompt when active.
- [ ] **Index status indicator in header** — Small dot showing if active scopes are indexed.
- [ ] **File edit history** — Track all edits with timestamps for session review.
- [ ] **persist index dates between restarts** - When caching scope indexes, include the date so it properly populates when reloading the previous index from cache

---

## ✅ Completed (archive)

- [x] **Discard button** — Abandon pending file edit
- [x] **Stop / cancel button** — Abort streaming response
- [x] **Better streaming UI during file edits** — Stage indicators with spinner
- [x] **Context window slider in settings** — Expose `num_ctx` as user setting
- [x] **Multiple file edits** — Unified multi-file diff editor with quality control
- [x] **Tool calling refactor** — Replaced prompt-chaining architecture with Ollama's native function calling API
  - Implemented 4 core tools: `read_file`, `search_files`, `list_scope`, `propose_file_edit`
  - Agentic loop architecture with streaming support
  - Fallback parser for text-based tool calls (llama3.1:8b compatibility)
  - Feature flag for gradual rollout (`USE_TOOL_CALLING`)
  - 93.8% reliability achieved in testing (exceeded 90% requirement)
  - Simplified architecture: eliminated brittle regex parsing and multiple LLM roundtrips
  - Security-focused file operations module (`file_ops.py`)
  - **COMPLETED:** 2026-03-27
