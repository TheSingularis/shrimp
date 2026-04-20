# SHRIMP* — TODO

Reordered by impact and strategic value. Frontloaded with high-value features that enable future work or significantly improve UX.

---

## 🎯 Tier 1: High Impact, Medium Effort (RECOMMENDED NEXT)

- [x] **Additional prompt instructions in settings** — Freetext field in settings that appends custom instructions to the system prompt. Persist to `config.py`.
  - **COMPLETED:** Global custom instructions + per-scope descriptions + auto-generate descriptions using LLM

- [x] **Save conversations** — Persist chat history to JSON files on disk (one file per conversation). Auto-save after each exchange.
  - **COMPLETED:** Full conversation history system with sidebar, load/save, delete, rename, auto-save

- [x] **Retry prompt button** — Regenerate the last assistant response.
  - **COMPLETED:** Retry button on last assistant message

---

## 🏗️ Tier 2: Strategic Enablers (build on Tier 1)

- [x] **Multiple conversation tabs** — Browser-style tabs with separate state per tab, auto-save on switch, title auto-update.

- [x] **Conversation Projects** — Group related conversations into projects.
  - **COMPLETED:** Creation/deletion, drag-and-drop, collapsible folders, color-coded indicators
  - **COMPLETED:** Project settings (name, description, color, default scopes, custom instructions)
  - **COMPLETED:** Per-project default scopes and custom instructions
  - **Future:** Project templates

---

## 🎨 Tier 3: Polish & Accessibility

- [x] **Links in chat open in new tab**

- [ ] **Native right-click context menus** — Context-appropriate menus across all panels.

- [ ] **Page freezing during file edit loading** — Monaco initialization causes UI freeze on large files.
  - ✅ Lazy loading Monaco, two-stage deferred rendering, loading indicators, per-tab initialization
  - **Remaining:** Web Workers for diff computation if still needed

- [x] **Update Branding** — Shrimp icons, 3 switchable themes, Lucide icons, SettingsModal.tsx, STYLE_GUIDE.md

- [x] **Mobile-responsive CSS** — 44px touch targets, landscape, ultra-compact <360px

- [x] **Ollama host settings** — Toggle local/external, connection validation, persist to `config.py`

---

## 🚀 Expansion: Dashboard & General-Purpose LLM Platform

> Full plan: `docs/EXPANSION_PLAN.md`

### Phase 1 — Foundation ✅ COMPLETE

- [x] `backend/notifications.py`, notification routes, SSE stream
- [x] `backend/scheduler.py` — APScheduler wrapper
- [x] Automation routes (`GET /automations`, `POST /run`, `PUT`)
- [x] Nav rail, DashboardHome, NotificationFeed, AutomationsPanel

### Phase 2 — Email Integration ✅ COMPLETE

- [x] `backend/email_client.py` — IMAP fetch, local JSON store, HTML stripping
- [x] `backend/email_processor.py` — LLM triage, urgency classification, action items
- [x] Email routes — inbox, fetch, config, triage
- [x] `automations/email_triage.py` — periodic fetch + triage job
- [x] `fetch_emails` tool in `tool_executor.py`
- [x] `EmailPanel.tsx`, `EmailDetail.tsx`, email config in `SettingsModal.tsx`
- [x] **Fix:** `email_client.py` UnboundLocalError — `record["id"]` self-referenced during dict construction. Fixed by assigning UUID to `email_id` variable first. *(2026-04-19)*

### Phase 3 — Obsidian Panel + Daily Digest ✅ COMPLETE

- [x] `backend/obsidian_ops.py`, Obsidian routes, Obsidian chat tools
- [x] `automations/daily_digest.py` — 8am digest
- [x] `ObsidianPanel.tsx`
- > **Note (2026-04-15):** ObsidianPanel shelved from nav rail until email UX is solid. Backend/tools intact. Re-add by restoring nav item and import in `App.tsx`.

### Phase 4 — Automations Dashboard + Additional Agents ✅ MOSTLY COMPLETE

- [x] **`automations/news_digest.py`** — RSS fetch, dedup, 48h window, checklist items with links *(2026-04-19)*
  - [x] LLM interest filtering via `NEWS_INTERESTS` config field
  - [x] Hyperlinked article titles in checklist
  - [ ] **Polish:** Interest filtering prompt quality — test against varied feed types and refine if LLM is too aggressive or too permissive
- [x] **`automations/obsidian_maintenance.py`** — Registered and running; scans for broken links/orphans
  - [ ] **Untested end-to-end** — trigger manually and verify notification output is useful
- [ ] **`automations/file_summary.py`** — Changed file summaries appended to `CHANGES.md` — not yet implemented
- [x] **`PUT /automations/{name}`** — enable/disable + cron update
- [x] **Persist automation enabled/cron state** — written to `AUTOMATION_CONFIG` in `config.py`, applied on startup *(2026-04-19)*
- [x] **RSS feed config in `SettingsModal.tsx`** — add/remove/toggle feeds *(2026-04-19)*
- [x] **AutomationsPanel.tsx** — real `running` state from backend, 1.5s polling, indeterminate bar, spinner badge *(2026-04-19)*

### Phase 4 — Daily Focus Checklist ✅ COMPLETE *(2026-04-19)*

- [x] `backend/checklist.py` — JSONL store, priority sort, rollover, dedup stubs, `update_item`, `list_untriaged`
- [x] `GET|POST /checklist`, toggle, delete, clear-completed, rollover
- [x] `POST /checklist/triage` — batches untriaged items to LLM, assigns urgent/high/normal/low, marks `triage_done`
- [x] `PUT /checklist/{item_id}` — update arbitrary fields
- [x] `DailyChecklist.tsx` — card-per-item layout matching flagged email style, left accent border by priority
- [x] `UrgencyBadge` per item (shows after triage), auto-triage on load and after automation completes
- [x] Checklist refreshes automatically when any automation finishes (custom window event)
- [x] `btn-checkbox` styled like `icon-btn` — accent-dim bg, accent border, `.checked` class, no inline overrides
- [ ] **Triage context quality** — triage prompt only has item text + source/feed. Could pass email subjects or summaries for richer classification. Low priority for now.
- [ ] **Manual priority override** — let user drag to reorder or click badge to change priority. Currently triage-only.

### Phase 5 — Advanced Chat Tools

- [ ] **`run_shell_command` tool** — Opt-in sandboxed shell execution with command whitelist in `config.py`
- [x] **`web_fetch` / web search tool** — Enabled via `WEB_SEARCH_ENABLED` config flag
- [ ] **`get_calendar_events` tool** — Read `.ics` files from configured local calendar directory
- [ ] **`send_notification` tool** — LLM can post to notification feed from chat response

---

## 🖥️ Standalone Electron App

- [x] **Dev-mode Electron app** — Spawns backend + Ollama, splash screen, tray icon, custom titlebar, window controls. `start-electron.sh` script handles full stack. *(2026-04-19: fixed missing root `package.json`)*
  - Run: `bash start-electron.sh` from project root (outside distrobox)

- [ ] **Distributable package** — `.AppImage` / `.deb` via `electron-builder`
  - Bundles Python backend (PyInstaller or shipped venv), Ollama binary, built frontend
  - Primary targets: Linux AppImage/deb; stretch: macOS dmg, Windows exe

---

## 📧 Email — Remaining Functionality

- [ ] **Revisit Inbox / Today's Focus logic** — Digest summary sometimes shows stale "Inbox clear" while new emails present. Needs rethink: show digest with timestamp, or only show still-relevant action items.

- [x] **Email search** — Keyword + semantic search across cached emails

- [x] **Compose / Reply / Forward** — Full SMTP compose modal, reply with quote, forward

- [x] **Folder operations** — Trash, archive, IMAP folder moves, folder tabs

- [x] **Multi-select + bulk actions** — Ctrl/shift-click, bulk mark/archive/trash/flag, right-click context menu

- [ ] **AI-assisted compose** — "Write for me" button: describe intent, LLM drafts full email

---

## 🔮 Tier 4: Advanced Features (future)

- [ ] **Fork conversations** — Branch from any point into a new tab. Requires tree structure.

- [ ] **Tool calling phase 2**
  - [x] Web search tool
  - [ ] Shell command execution tool
  - [ ] File system operations (create, delete, move)

---

## 💡 Nice to Have / Lower Priority

- [ ] **Hardware-based performance estimation** — Detect specs, recommend models, show estimated tokens/sec
- [ ] **GPU utilization indicator** — Live GPU memory usage polling `ollama ps`
- [ ] **Index status indicator in header** — Small dot showing if active scopes are indexed
- [ ] **File edit history** — Track all edits with timestamps for session review
- [ ] **Persist index dates between restarts** — Cache scope index dates so "last indexed" is accurate after reload

---

## Under Consideration

### Project Templates

Pre-configured project setups for faster creation. See existing detail in git history. Decision: revisit when project usage patterns become clearer.

---

## ✅ Completed (archive)

- [x] Discard button, stop/cancel button, streaming UI stage indicators
- [x] Context window slider in settings
- [x] Multiple file edits with unified diff editor
- [x] Tool calling refactor — Ollama native function calling, agentic loop, fallback parser
