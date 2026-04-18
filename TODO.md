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

- [ ] **Investigate page freezing during file edit loading/applying** — UI freezes when loading multi-file diffs or applying edits, likely due to Monaco editor initialization or synchronous rendering.
  - ✅ **Implemented:** Lazy loading Monaco with React.lazy + Suspense (reduces bundle size, defers initialization)
  - ✅ **Implemented:** Two-stage deferred rendering with requestIdleCallback:
    - Stage 1: Defer tab initialization (which tabs to render)
    - Stage 2: Defer diff computation (DeferredDiffEditor waits for idle before loading content)
  - ✅ **Implemented:** Loading indicators at each stage ("Loading diff editor..." → "Preparing diff..." → "Computing diff...")
  - ✅ **Implemented:** Per-tab initialization (only active tab renders immediately, others defer until switched or browser idle)
  - **Future optimizations if needed:**
    - Web Workers for diff computation (offload to background thread)
    - Monaco async diff API usage
    - Progressive rendering for large files

- [x] **Update Branding** — Update styling to use shrimp icons (`frontend/public/icons`) and cohesive color scheme. Maybe add theme options in settings. Update ALL Icons to use a cohesive design.
  - **COMPLETED:** Shrimp icons used in header and welcome screen
  - **COMPLETED:** 3 switchable themes in settings (Shrimp/Purple/Blue)
  - **COMPLETED:** All icons standardized with Lucide React
  - **COMPLETED:** Settings reworked as full-window modal (SettingsModal.tsx)
  - **COMPLETED:** Comprehensive STYLE_GUIDE.md (560+ lines covering colors, typography, spacing, components, icons, animations, responsive design)

- [x] **Mobile-responsive CSS** — Make layout work on small screens for phone/tablet access.
  - **COMPLETED:** 44px touch targets, landscape mode, horizontal scrolling, ultra-compact mode for <360px screens

- [x] **Ollama host settings** — Radio toggle between local (managed by SHRIMP) and external (user-supplied URL). Persist to `config.py`.
  - **COMPLETED:** Settings UI with connection validation, success feedback, http:// protocol handling

---

## 🚀 Expansion: Dashboard & General-Purpose LLM Platform

> Full plan: `docs/EXPANSION_PLAN.md`

### Phase 1 — Foundation (Dashboard Shell + Notifications) ✅ COMPLETE

- [x] **`backend/notifications.py`** — Append-only JSONL feed with `append()`, `list()`, `mark_read()`, `delete()`
- [x] **Notification routes in `main.py`** — `GET /notifications`, `POST /notifications/{id}/dismiss`, `DELETE /notifications/{id}`, `GET /notifications/stream` (SSE)
- [x] **`backend/scheduler.py`** — APScheduler wrapper; `register_job`, `get_job_status`, `trigger_job`; started on FastAPI startup hook
- [x] **Job routes in `main.py`** — `GET /jobs`, `POST /jobs/{name}/run`, `PUT /jobs/{name}`
- [x] **Nav rail in `App.tsx`** — Dashboard, Chat, Email, Obsidian, Jobs panels; Chat is default; zero regressions
- [x] **`DashboardHome.tsx`** — Landing page: quick stats, recent conversations, job status grid, quick actions
- [x] **`NotificationFeed.tsx`** — SSE consumer, notification list, dismiss; overlay drawer
- [x] **`NotificationBadge.tsx`** — Unread count badge on bell icon in nav rail
- [x] **`useNotifications.ts`** — SSE hook with reconnect logic
- [x] **`JobsPanel.tsx`** — Job status grid with run/enable/disable controls
- [x] **New `api.ts` entries** — notification and job API calls

### Phase 2 — Email Integration ✅ COMPLETE

- [x] **`backend/email_client.py`** — IMAP fetch (stdlib imaplib in executor), local JSON store in `emails/`, HTML stripping via stdlib html.parser
- [x] **`backend/email_processor.py`** — LLM triage prompt: classify urgency, extract action items, post notification
- [x] **Email routes in `main.py`** — `GET /email/inbox`, `POST /email/fetch`, `GET|POST /email/config`, `POST /email/config/test`, `GET /email/{id}`, `POST /email/{id}/triage`
- [x] **`EMAIL_CONFIG` block in `config.py`** — IMAP host, port, SSL, credentials, poll interval
- [x] **`backend/jobs/email_triage.py`** — Periodic fetch + triage job registered with APScheduler
- [x] **`fetch_emails` tool in `tool_executor.py`** — LLM can query local email cache from chat
- [x] **`EmailPanel.tsx`** — Two-pane inbox browser (list + detail), responsive mobile/desktop
- [x] **`EmailDetail.tsx`** — Full email view with streaming "Triage with AI" button
- [x] **Email config tab in `SettingsModal.tsx`** — IMAP credentials, test connection, save

### Phase 3 — Obsidian Panel + Daily Digest ✅ COMPLETE

- [x] **`backend/obsidian_ops.py`** — `list_vault_pages`, `get_page`, `propose_page_update`, `propose_page_create`; wikilink validation; frontmatter parsing
- [x] **Obsidian routes in `main.py`** — `GET /obsidian/pages`, `POST /obsidian/search`, `GET /obsidian/page`, `POST /obsidian/page`, `PUT /obsidian/page`
- [x] **Obsidian tools in `tool_executor.py`** — `create_obsidian_page`, `update_obsidian_page`, `search_obsidian`
- [x] **`jobs/daily_digest.py`** — Morning digest (8am): unread emails + recent conversations → notification + optional Obsidian daily note
- [x] **`ObsidianPanel.tsx`** — Vault browser with client-side filter + semantic search, page detail view, frontmatter display, broken wikilink warnings

> **Note (2026-04-15):** `ObsidianPanel` tab removed from the UI nav rail — shelved until email UX is solid. Backend routes, tools, and `ObsidianPanel.tsx` remain intact. The panel currently offers no advantage over Obsidian directly; revisit when SHRIMP can meaningfully enhance the workflow (e.g. inline AI editing, smart backlinks, or cross-referencing email content with notes). Re-add by restoring the nav item and import in `App.tsx`.

### Phase 4 — Jobs Dashboard + Additional Agents

- [ ] **`jobs/news_digest.py`** — RSS fetch, LLM summarise, vault relevance matching
- [ ] **`jobs/obsidian_maintenance.py`** — Broken links, orphan detection, weekly report
- [ ] **`jobs/file_summary.py`** — Changed file summaries appended to `CHANGES.md`
- [ ] **`PUT /jobs/{name}`** route — schedule editing / enable/disable
- [ ] **RSS/OPML config in `config.py`**
- [ ] **`JobsPanel.tsx`** — Job status grid with trigger and schedule controls
- [ ] **RSS feed config in `SettingsModal.tsx`**

### Phase 5 — Advanced Chat Tools

- [ ] **`run_shell_command` tool** — Opt-in sandboxed shell execution with command whitelist in `config.py`
- [ ] **`web_fetch` tool** — Fetch + extract readable text from a URL; disabled by default
- [ ] **`get_calendar_events` tool** — Read `.ics` files from configured local calendar directory
- [ ] **`send_notification` tool** — LLM can post to notification feed from chat response

---

## 🖥️ Standalone Electron App

- [x] **Standalone Electron app (dev-mode working)** — Electron shell launches, spawns the Python backend, shows splash screen while it boots, then loads the built frontend. System tray with show/hide and quit. Tested on Arch Linux (distrobox).
  - Run: `DISPLAY=:0 npx electron . --no-sandbox` from the project root inside the distrobox
  - Build frontend first: `cd frontend && ELECTRON=1 npm run build`
  - System deps needed in distrobox: `nss libxss atk gtk3 libdrm alsa-lib mesa`

- [ ] **Electron: distributable package** — Package as installable `.AppImage` / `.deb`.
  - **What it includes:**
    - Electron wrapper for the React frontend
    - Bundled Python backend (FastAPI/uvicorn) launched as child process
    - System tray icon with quick access
    - Auto-start backend on app launch
    - Proper shutdown handling (cleanup Python/Ollama processes on quit)
    - Native file picker dialogs for scope selection
    - Linux `.AppImage`/`.deb` as primary targets; macOS `.dmg` and Windows `.exe` as stretch goals
  - **Approach:** Electron main process spawns `uvicorn` and `ollama serve` on startup, waits for health check, then loads the React UI in a BrowserWindow. Python deps bundled via PyInstaller or shipped as a venv.

## 📧 Email — Remaining Functionality

- [ ] **Revisit Inbox / Today's Focus logic** — The digest summary sometimes shows stale content (e.g. "Inbox clear") while new emails are present. Currently hidden when `visible.length > 0` as a workaround. Needs a proper rethink: maybe show digest with a timestamp, or only show action items that are still relevant given current inbox state.

- [x] **Email search** — Keyword (subject/sender/body) and semantic search across cached emails. Search bar in EmailPanel header.

- [x] **Compose new email** — Write and send via SMTP. `ComposeModal.tsx` with To/Subject/Body/CC fields, SMTP backend, config in Settings → Email.

- [x] **Reply / Forward** — Reply/forward from EmailDetail with quoted original and pre-populated fields via ComposeModal.

- [x] **Folder operations** — Trash, archive, and IMAP folder moves implemented. Action buttons in EmailDetail header. Grouped folder tabs (Sent, Filed/Trash) with dropdowns.

- [x] **Multi-select + bulk actions** — Ctrl+click to toggle, shift+click to range-select. No checkboxes — visual highlight only. Bulk action bar with: Mark read, Mark unread, Archive, Trash, Flag.
  - [x] Add right click context menu for bulk/individual email actions

- [ ] **AI-assisted compose** — "Write for me" button in compose modal. Describe what you want to say, LLM drafts the full email. Optional: suggest subject line from body.

---

## 🔮 Tier 4: Advanced Features (future)

- [ ] **Fork conversations** — Branch a conversation from any point in history into a new tab. Requires tree structure instead of flat array.
  - **Prerequisite:** Multiple conversation tabs

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
