# SHRIMP* — TODO

---

## 🔌 Refactor: Plugin System

> Inspired by Obsidian's plugin architecture — make SHRIMP modularly extensible while keeping the core lean.

Split functionality into three layers:

1. **Core** — irreducible kernel: RAG engine, chat pipeline, tool calling loop, scope management, settings. Always on.
2. **Core Plugins** — first-party features shipped with SHRIMP but disableable. Same API as community plugins.
3. **Community Plugins** — user-installed modules registering new automations, tools, UI panels, or settings tabs.

### Core Plugin Candidates

| Plugin | Source files | Contributes |
|---|---|---|
| `email` | `email_client.py`, `email_processor.py`, `email_smtp.py`, `email_idle.py`, `EmailPanel.tsx` | IMAP/SMTP, triage, inbox panel |
| `automations` | `scheduler.py`, `automations/`, `AutomationsPanel.tsx` | APScheduler, job registry, automations UI |
| `news_digest` | `automations/news_digest.py` | RSS feeds, interest filtering, checklist items |
| `daily_digest` | `automations/daily_digest.py` | Morning email summary |
| `obsidian` | `obsidian_ops.py`, `ObsidianPanel.tsx` | Vault browser, obsidian chat tools |
| `checklist` | `checklist.py`, `DailyChecklist.tsx` | Focus list, AI triage |
| `notifications` | `notifications.py`, `NotificationFeed.tsx` | In-app notification feed |

### Plugin API (sketch)

```python
# plugins/email/__init__.py
MANIFEST = {
    "id": "email",
    "name": "Email Client",
    "core": True,
    "description": "IMAP/SMTP email integration with AI triage",
    "backend": ["routes", "startup", "tools"],
    "frontend": ["panel", "settings_tab"],
}
```

Backend hooks: `routes(app)`, `startup()`, `tools() -> list[Tool]`, `settings_schema() -> dict`

Frontend contributions: **Panel** (nav rail entry), **Settings tab**, **Dashboard widget**, **Checklist source**

### Implementation Phases

- **Phase A** *(refactor only, no UX change)* — define manifest interface, move modules into `plugins/` subdirs, wire plugin loader in `main.py`, add `DISABLED_PLUGINS` to config
- **Phase B** — Plugins tab in SettingsModal; list with name, description, core badge, toggle
- **Phase C** — Community plugins from `~/.shrimp/plugins/`; drop-in directory, explicit user enable required

### Open Questions

- Frontend dynamic loading — panels are static imports in `App.tsx`; need lazy imports keyed by plugin ID
- Hot reload vs restart — backend likely needs restart; frontend can conditionally render from fetched plugin list
- Tool sandboxing — permission model for community plugins accessing files/network?
- Config ownership — each plugin owns its keys; need collision avoidance and graceful degradation when disabled

**Decision:** Not imminent. Revisit when the monolith feels unwieldy or a clear community use-case emerges.

---

## 🖥️ Electron — Distributable Package

- [ ] Package as `.AppImage` / `.deb` via `electron-builder`
  - Bundle Python backend (PyInstaller or shipped venv) + Ollama binary + built frontend
  - Primary: Linux AppImage/deb — stretch: macOS dmg, Windows exe

---

## 📧 Email — Open Items

- [ ] **Revisit Today's Focus / digest logic** — sometimes shows stale "Inbox clear" while new emails are present; needs timestamp or relevance filter
- [ ] **AI-assisted compose** — "Write for me" button: user describes intent, LLM drafts full email

---

## 🤖 Automations — Open Items

- [ ] **`file_summary.py`** — append changed-file summaries to `CHANGES.md` on commit; not yet implemented
- [ ] **`obsidian_maintenance.py`** — registered and scheduled but untested end-to-end; trigger manually and verify notification output
- [ ] **News digest interest filtering** — test prompt against varied feed types; refine if LLM is too aggressive or too permissive

---

## ✏️ Checklist — Open Items

- [ ] **Triage context richness** — prompt currently only has item text + source name; passing email subjects or article summaries would improve classification accuracy
- [ ] **Manual priority override** — let user click the badge or drag to reorder; currently triage-only

---

## 💬 Chat — Open Items

- [ ] **`run_shell_command` tool** — opt-in sandboxed shell execution with whitelist in `config.py`
- [ ] **`get_calendar_events` tool** — read `.ics` files from configured local calendar directory
- [ ] **`send_notification` tool** — LLM can post to notification feed from within a chat response
- [ ] **Fork conversations** — branch from any point into a new tab; requires tree structure instead of flat array
- [ ] **Shell + filesystem tools** — create, delete, move files via tool calls

---

## 🎨 UI / Polish — Open Items

- [ ] **Native right-click context menus** — context-appropriate menus across all panels (chat, email, etc.)
- [ ] **Monaco diff freezing** — lazy loading + deferred rendering already in place; add Web Workers for diff computation if still needed
- [ ] **Project templates** — pre-configured project setups; revisit when usage patterns become clearer

---

## 💡 Nice to Have

- [ ] Hardware-based model recommendations — detect CPU/RAM/VRAM, estimate tokens/sec, suggest suitable models
- [ ] GPU utilization indicator — live VRAM usage polling `ollama ps`
- [ ] Index status indicator in header — dot showing whether active scopes are indexed
- [ ] File edit history — timestamped log of all edits per session
- [ ] Persist index dates between restarts — "last indexed" accurate after reload

---

## 🔧 Code Quality — Pending Refactors

> From `docs/REFACTORS.md`. Tackle in order — atomic writes first (highest risk if skipped), then response normalization, then asyncio guard.

- [x] **Atomic config writes** — `main.py:write_config()`, `plugins/email/backend/__init__.py:_write_email_config()`, `plugins/news/backend/__init__.py`
  - Extract a shared `_atomic_write(path, content)` helper in `main.py` (or a new `config_utils.py`)
  - Use `tempfile.NamedTemporaryFile` + `os.replace()` — atomic on POSIX, safe on Windows
  - Replace all `config_path.write_text(current)` calls with the helper (5–6 call sites across 3 files)
  - Test: kill the process mid-write with `kill -9` and confirm `config.py` is intact

- [x] **Normalize email fetch response envelopes** — `plugins/email/backend/__init__.py`
  - `POST /plugins/email/fetch` returns `{"fetched": N, "emails": [...]}` 
  - `POST /plugins/email/fetch/{folder}` returns `{"fetched": N, "folder": ..., "message": ...}` (no emails list)
  - Normalize both to `{"fetched": N, "folder": ..., "emails": [...]}` 
  - Check `plugins/email/frontend/` for any consumers before changing; update them if needed

- [x] **Guard against `asyncio.run()` in automation threads** — won't do; fails loudly at runtime, documented in PLUGINS.md — convention enforcement
  - Add a grep check or comment in `scheduler.py:_wrapper()` noting the restriction
  - Simplest enforcement: add a one-liner to `CLAUDE.md` or a `# NEVER use asyncio.run() here` comment in the wrapper so future AI edits don't regress it
  - Optional: add a CI grep: `grep -r "asyncio\.run(" plugins/*/backend/ && echo "Use scheduler.run_async() instead" && exit 1`

---

## ✅ Completed

**Core chat & UX**
- Custom prompt instructions (global + per-scope, with LLM auto-generate)
- Conversation save/load/rename/delete with sidebar
- Multiple conversation tabs with auto-save
- Conversation projects — folders, drag-and-drop, color, per-project scopes + instructions
- Retry button on last assistant message
- Streaming markdown rendering, stage indicators, tool call markers
- Tool calling refactor — Ollama native function calling, agentic loop, fallback parser
- Line-range file reading and editing, smart auto-splice
- Multi-file diff editor (up to 5 files, per-file approve/reject)
- Web search tool (`WEB_SEARCH_ENABLED`)
- Links in chat open in new tab
- Context window slider in settings
- Discard / stop-streaming buttons

**Branding & theming**
- 3 switchable themes (Shrimp, Purple, Blue) with CSS variable system
- Shrimp icons in header, favicon, welcome screen
- Lucide React icon standardization
- SettingsModal (full-window, tabbed) replacing side drawer
- STYLE_GUIDE.md

**Infrastructure**
- Mobile-responsive layout — 44px touch targets, landscape, <360px ultra-compact
- Ollama host settings — local vs external, connection validation
- Language setting (6 options, persisted)
- Electron dev-mode app — splash screen, tray icon, custom titlebar, `start-electron.sh`

**Dashboard & notifications**
- Notification feed with SSE push, badge, dismiss
- APScheduler wrapper, automation routes, AutomationsPanel
- Real `running` state polled from backend; indeterminate bar while active
- Automation cron + enabled state persisted to `AUTOMATION_CONFIG` in config.py

**Email**
- IMAP fetch, local JSON store, HTML stripping (`email_client.py`)
- LLM triage — urgency, action items, notifications (`email_processor.py`)
- SMTP compose, reply, forward
- Folder operations — trash, archive, IMAP moves, folder tabs
- Multi-select + bulk actions — ctrl/shift-click, mark/archive/trash/flag, right-click menu
- Email search — keyword + semantic
- IMAP IDLE listener for real-time push
- Fix: `email_client.py` crash — `record["id"]` self-reference during dict construction

**Daily Focus Checklist**
- JSONL store, priority sort, rollover, dedup stubs
- Card-per-item layout matching flagged email style; left accent border by priority
- AI triage via `POST /checklist/triage` — urgent/high/normal/low, `UrgencyBadge` per item
- Auto-triage on load; refresh triggered by automation completion via window event
- `btn-checkbox` styled like `icon-btn`

**News digest**
- RSS/Atom fetch, 48h dedup window, checklist items with hyperlinked titles
- LLM interest filtering via `NEWS_INTERESTS` settings field
- News interests support multiline text (triple-quoted strings in config)

**Obsidian**
- Vault browser, frontmatter, broken wikilink warnings (`ObsidianPanel.tsx`)
- Obsidian chat tools: `search_obsidian`, `create_obsidian_page`, `update_obsidian_page`
- Daily digest job (8am) — unread emails + conversations → summary + daily note
- *Panel shelved from nav rail; backend/tools intact. Restore nav item + import in `App.tsx` to re-enable.*
