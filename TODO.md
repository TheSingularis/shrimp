# SHRIMP* — Development Roadmap

---

## 🔌 Phase 1: Frontend Plugin Dynamic Loading ✅

> **Goal**: Enable community plugins to register nav items, panels, and settings tabs at runtime.

### Current State
- Backend plugin system is complete (`plugins/email/`, `plugins/news/`)
- Frontend plugin system fully implemented and smoke-tested

### Implementation Tasks

#### 1.1 Plugin UI Registry
- [x] Define `PluginUI` interface in `frontend/src/plugins/types.ts`
- [x] Create plugin loader hook: `usePluginUI()` that discovers enabled plugins
- [x] Implement lazy loading via `import.meta.glob('plugins/*/frontend/*.tsx')`

#### 1.2 Dynamic Navigation Rail
- [x] Refactor `App.tsx` nav rail to iterate over registered plugin nav items
- [x] Add plugin badge counts (e.g., email unread) as per-plugin components
- [x] Ensure routing works for plugin panels (conditional render)

#### 1.3 Dynamic Settings Tabs
- [x] Refactor `SettingsModal` to accept plugin settings sections
- [x] Render core tabs (Appearance, Models, Scopes) + plugin tabs
- [x] Add "Plugins" management tab

#### 1.4 Dynamic Dashboard Cards
- [x] Refactor `DashboardHome` to accept `dashboardCards: React.ComponentType[]` prop
- [x] Remove hardcoded email sections; use plugin cards instead
- [x] Ensure card click navigation routes to plugin panel

### Acceptance Criteria
- [x] New plugin can add UI by exporting default `ShrimpPluginFrontend` in `frontend/index.tsx`
- [x] Frontend auto-discovers and renders plugin UI without code changes
- [x] Plugin enable/disable toggles hide/show UI components immediately
- [x] No runtime errors when loading disabled plugins

---

## 📧 Phase 2: Email Triage Sync Latency Fix

> **Goal**: Eliminate stale UI state in email inbox and digest panels.

### Problem
TODO.md (old) notes: *"Revisit Today's Focus / digest logic — sometimes shows stale 'Inbox clear' while new emails are present"*. The `email_synced` event is not propagated to the frontend.

### Implementation Tasks

#### 2.1 Backend Event Emission
- [ ] Add SSE endpoint in `main.py`: `GET /events` that streams `email_synced` events
- [ ] In `plugins/email/backend/email_sync.py`, emit event after IDLE/fetch completes:
  ```python
  # Pseudo-code
  event_bus.emit("email_synced", {"folder": "INBOX", "count": 5})
  ```
- [ ] Implement simple in-memory event bus (dict of callbacks) in `backend/event_bus.py`

#### 2.2 Frontend Event Subscription
- [ ] Create `useEventBus()` hook in `frontend/src/hooks/`:
  ```typescript
  const { onEvent } = useEventBus();
  onEvent('email_synced', (data) => { invalidateQueries(['email', 'inbox']) });
  ```
- [ ] Refactor `useEmailUnreadCount` hook to subscribe to events instead of polling
- [ ] Update `DashboardHome` email cards to invalidate cache on event

#### 2.3 Fallback Polling (if SSE is too complex)
- [ ] Alternative: Add 5s polling interval for `GET /plugins/email/sync-state`
- [ ] Use React Query `refetchInterval` instead of manual `setInterval`
- [ ] Ensure polling stops when tab is inactive (page visibility API)

### Acceptance Criteria
- New email arrives → inbox count updates within 1 second (no manual refresh needed)
- "Inbox clear" message only shows when truly empty
- No excessive polling (max 1 request/5s per tab)
- Works with IDLE long-polling and manual fetch triggers

---

## 🎨 Phase 3: Plugin Management UI

> **Goal**: Unified view for discovering, enabling/disabling, and configuring plugins.

### Implementation Tasks

#### 3.1 Plugins Settings Tab
- [x] Add new tab to `SettingsModal`: "Plugins" (after Advanced)
- [x] List all discovered plugins with name, version, description, category, enable/disable toggle
- [x] Fetch plugin list from `GET /api/plugins`

#### 3.2 Plugin Enable/Disable Flow
- [x] PUT `/api/plugins/{id}` with `{ enabled: bool }`
- [x] Backend writes to `PLUGINS_CONFIG` in `config.py`
- [x] Show "Requires restart" banner when a backend plugin is toggled (Electron: full relaunch; browser: page reload)
- [x] Frontend hides UI components immediately (no restart needed for frontend-only)
- [x] `has_backend` field exposed on `/api/plugins` response so frontend knows which plugins need a restart

#### 3.3 Community Plugin Directory (Future)
- [ ] Define `~/.shrimp/plugins/` discovery directory
- [ ] Add "Install from URL" input for GitHub repo archives
- [ ] Validate plugin.json schema before installation
- [ ] Show install progress bar and success/error states

### Acceptance Criteria
- [x] User can enable/disable any plugin from Settings → Plugins
- [x] UI updates immediately when toggle is changed
- [x] Plugin config persists in `config.py`
- [x] Clear messaging about restart requirements

---

## 🛡️ Phase 4: Tool Calling Reliability

> **Goal**: Improve tool calling success rate from 93.8% to >98% and document model compatibility.

### Implementation Tasks

#### 4.1 Model Compatibility Matrix
- [ ] Create `docs/MODEL_COMPATIBILITY.md` with tested models:
  - Native function calling (100%): `llama3.1:8b`, `qwen2.5:7b`
  - Fallback parser (95%): `llama3.1:8b` (text mode), `mistral:7b`
  - Not recommended: older models without function calling support
- [ ] Add model detection in Settings → Models page (show "Recommended for tool calling" badge)

#### 4.2 Structured Output Fallback
- [ ] Experiment with Ollama's `/api/chat format=json` structured output
- [ ] If model supports JSON mode, use as alternative to function calling
- [ ] Add feature flag: `USE_STRUCTURED_OUTPUT` (default: false)

#### 4.3 Telemetry and Debugging
- [ ] Add `GET /debug/tool-calls` endpoint that shows:
  - Last 10 tool call attempts with success/failure
  - Model used, iteration count, timeout status
- [ ] Display in chat UI as collapsible debug panel (dev mode only)

### Acceptance Criteria
- User can see which models are recommended for tool calling
- Failed tool calls show clear error message in chat
- Debug panel helps diagnose model-specific issues

---

## 🔐 Phase 5: Plugin Security Model (Future)

> **Goal**: Sandbox community plugins to prevent malicious file/network access.

### Implementation Tasks

#### 5.1 Permission System Design
- [ ] Define permission enum in `plugin_base.py`:
  ```python
  class Permission(Enum):
      READ_FILES = "read_files"
      WRITE_FILES = "write_files"
      NETWORK_ACCESS = "network_access"
      SCHEDULE_JOBS = "schedule_jobs"
      EXECUTE_COMMANDS = "execute_commands"
  ```
- [ ] Add `permissions: list[Permission]` to plugin manifest

#### 5.2 Backend Enforcement
- [ ] Wrap file ops in `file_ops.py` with permission check:
  ```python
  def write_accept(...):
      if not plugin_has_permission("write_files"):
          raise PermissionError("Plugin not authorized to write files")
  ```
- [ ] Network access: proxy requests through backend with URL whitelist
- [ ] Command execution: require explicit command whitelist in `config.py`

#### 5.3 UI Permission Warnings
- [ ] Show permission list when enabling community plugin
- [ ] Add "⚠️ This plugin can access your files/network" banner
- [ ] Log all plugin actions to `plugin_audit.log` for review

### Acceptance Criteria
- Community plugins cannot access files without explicit permission
- User sees clear warning before enabling high-risk plugin
- Audit log tracks all plugin file/network operations

---

## 📝 Phase 6: Additional Improvements

### 6.1 Conversation History Export
- [ ] Add "Export conversation" button in conversation context menu
- [ ] Support formats: JSON (full), Markdown (readable), CSV (messages only)
- [ ] Include all attachments, tool calls, and edit history

### 6.2 Project Templates
- [ ] Define `projects/` directory with template JSON files
- [ ] Pre-configured scopes, custom instructions, and default model per project type
- [ ] Examples: "Web App", "Research Notes", "Book Draft"

### 6.3 Index Status Indicator
- [ ] Add dot indicator in header showing if active scopes are indexed
- [ ] Green = indexed within last 24h, Red = never indexed or stale
- [ ] Click to re-index immediately

### 6.4 File Edit History Log
- [ ] Create `data/edits.jsonl` with timestamped edit entries
- [ ] Track: file path, scope, original hash, new hash, conversation_id
- [ ] Add "View edit history" panel in settings

---

## 🖥️ Appearance / Display

- [ ] **sRGB toggle restart notification**: After toggling "Force sRGB color profile" in Settings → Appearance, show an inline "Restart required to apply" notice near the toggle (similar to the plugin restart banner in Phase 3.2).

## 📧 Email UX

- [x] **Accurate unread badge count**: Badge and panel header now read from `/plugins/email/unread-count` (full cache scan, no limit) instead of filtering a page of loaded emails.
- [x] **Email list pagination**: "Load more" button appends next 100 emails; previously emails beyond position 100 were cached but unreachable in the UI.
- [ ] **Remember remote image senders**: When the user clicks "Load images" on an email, persist that sender's address to a whitelist so remote images load automatically for future emails from them.

---

## 🧪 Experimental / Nice to Have

- [ ] **Hardware-based model recommendations**: Detect CPU/RAM/VRAM, estimate tokens/sec
- [ ] **GPU utilization indicator**: Poll `ollama ps` for live VRAM usage
- [ ] **Fork conversations**: Branch from any point into new tab (tree structure)
- [ ] **Shell command tool**: Opt-in sandboxed execution with whitelist
- [ ] **Calendar events tool**: Read `.ics` files from configured directory
- [ ] **Send notification tool**: LLM can post to notification feed from chat

---

## 📋 Implementation Notes

### Plugin System Architecture
- Backend plugins use `importlib` for dynamic loading (already done)
- Frontend uses `import.meta.glob` for lazy loading (needs implementation)
- Plugin manifest (`plugin.json`) defines API contributions
- Settings persistence in `config.py` via regex replacement (atomic writes)

### Event Bus Design
- Simple in-memory dict: `{ event_name: [callback1, callback2] }`
- SSE endpoint streams to all connected clients
- Alternative: polling with React Query `refetchInterval`

### Security Model Design
- Permission checks happen at API layer, before business logic
- Community plugins run in same process (no sandboxing) — rely on permission model
- Audit logging for compliance and debugging

---

## ✅ Completed (Reference)

See `TODO.md.old` for completed items including:
- Plugin system backend implementation
- Email plugin with IMAP/SMTP, triage, digest
- Multi-file editing with line-range support
- Tool calling architecture (agentic loop)
- Projects and conversations organization
- Daily checklist with AI triage
- Obsidian integration
- Notification feed with SSE push
- Electron packaging setup

---
