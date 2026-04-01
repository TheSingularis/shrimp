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
  - **COMPLETED:** Per-project default scopes (override conversation scopes when opening)
  - **COMPLETED:** Per-project custom instructions (appended to system prompt)
  - **COMPLETED:** Pill-style scope selector matching header design
  - **COMPLETED:** Project statistics (conversation count, last activity, total messages) - shows in header and settings modal
  - **Future enhancements:**
    - [ ] Project templates for quick setup

---

## 🎨 Tier 3: Polish & Accessibility

- [ ] **Investigate page freezing during file edit loading/applying** — UI freezes when loading multi-file diffs or applying edits, likely due to Monaco editor initialization or synchronous rendering. Consider:
  - Web Workers for diff computation
  - Virtual scrolling for large diffs
  - Lazy loading Monaco instances
  - Async rendering with loading indicators
  - Debouncing/throttling during edit application

- [ ] **Update Branding** — Update styling to use shrimp icons (`frontend/public/icons`) and cohesive color scheme. Maybe add theme options in settings. Update ALL Icons to use a cohesive design.
  - Rework settings page to utilize more screen space (possibly full window instead of drawer)
  - Create a cohesive Styling Guide document defining colors, spacing, typography, component patterns
  - **Why now:** Visual polish improves perceived quality. Quick win.

- [x] **Mobile-responsive CSS** — Make layout work on small screens for phone/tablet access.
  - **COMPLETED:** 44px touch targets, landscape mode, horizontal scrolling, ultra-compact mode for <360px screens

- [x] **Ollama host settings** — Radio toggle between local (managed by SHRIMP) and external (user-supplied URL). Persist to `config.py`.
  - **COMPLETED:** Settings UI with connection validation, success feedback, http:// protocol handling

---

## 🔮 Tier 4: Advanced Features (future)

- [ ] **Fork conversations** — Branch a conversation from any point in history into a new tab. Requires tree structure instead of flat array.
  - **Prerequisite:** Multiple conversation tabs

- [ ] **Standalone Electron app** — Package as distributable desktop application for easy installation without technical setup.
  - **What it includes:**
    - Electron wrapper for the React frontend
    - Bundled Python backend (FastAPI/uvicorn) as subprocess
    - Optional: Bundled Ollama binary (or auto-download on first run)
    - System tray icon with quick access
    - Auto-start backend on app launch
    - Proper shutdown handling (cleanup Python/Ollama processes)
    - Native file picker dialogs for scope selection
    - OS-specific installers (`.dmg` for macOS, `.exe` for Windows, `.AppImage`/`.deb` for Linux)
  - **Benefits:**
    - One-click install for non-technical users
    - No need to run `nix-shell` or manage terminals
    - Better OS integration (menubar, notifications, file associations)
    - Can ship pre-configured with good default models
  - **Challenges:**
    - Large bundle size (especially if including Ollama)
    - Platform-specific packaging and signing
    - Keeping Python/Node dependencies aligned
    - Auto-update mechanism for backend code
  - **Alternatives to consider:**
    - Tauri (Rust-based, smaller than Electron)
    - Native Python GUI (PyQt/PySide) instead of web stack
  - **Why later:** Significant packaging effort. Current web app with nix-shell works well for technical users.

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

## Under Consideration

### Project Templates

Pre-configured project setups for faster creation with sensible defaults.

**Concept:** Instead of manually filling out project settings each time, select from pre-made templates that include scopes, custom instructions, and colors.

**Example Templates:**
- **Coding Project**: scopes=`["shrimp"]`, instructions="Focus on code quality and best practices", color=blue
- **Personal Notes**: scopes=`["obsidian"]`, instructions="Be conversational, help organize thoughts", color=purple
- **D&D Campaign**: scopes=`["obsidian"]`, instructions="D&D assistant for campaign planning and lore", color=red

**Implementation Options:**
- **Option A (Simple)**: 3-5 built-in templates shipped with SHRIMP. "New Project" button has dropdown for "Blank" or "From Template"
- **Option B (Advanced)**: User-defined templates with save/edit/delete. Right-click project → "Save as Template"
- **Option C (Hybrid)**: Start with built-in, add user templates later

**UI Flow:**
1. Click "+ New Project"
2. Modal shows "Create from Template" section at top
3. Template cards with name/icon/description
4. Click template → pre-fills modal
5. Edit if needed, create project

**Benefits:**
- Faster project creation (one click vs filling 4+ fields)
- Consistency across similar projects
- Onboarding (shows users what's possible)
- Reusable configurations

**When This Makes Sense:**
- Creating new projects frequently (weekly/monthly)
- Multiple projects of same "type" (e.g., multiple coding projects)
- Helping new users get started

**When to Skip:**
- Stable set of projects that rarely change
- Only 2-3 total projects
- Feels like over-engineering for workflow

**Decision:** TBD - revisit when project usage patterns become clearer

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
