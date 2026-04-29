# SHRIMP Expansion Plan — General-Purpose LLM Assistant Dashboard

## Table of Contents

1. [Vision and Goals](#1-vision-and-goals)
2. [What Stays the Same vs. What Changes](#2-what-stays-the-same-vs-what-changes)
3. [Proposed Architecture Changes](#3-proposed-architecture-changes)
4. [Tool/Agent Catalog](#4-toolagent-catalog)
5. [Email Integration Approach](#5-email-integration-approach)
6. [Obsidian Integration Approach](#6-obsidian-integration-approach)
7. [Notification and Dashboard Design](#7-notification-and-dashboard-design)
8. [Phased Implementation Roadmap](#8-phased-implementation-roadmap)
9. [Technical Decisions and Trade-offs](#9-technical-decisions-and-trade-offs)

---

## 1. Vision and Goals

SHRIMP is currently a focused, single-purpose tool: chat with your files, propose edits, review diffs. The expansion goal is to make it the **single local-first intelligence dashboard** for a personal computing environment — the place you go when you want an LLM to do something on your behalf, not just answer a question.

The expanded SHRIMP has three modes of operation:

- **Reactive** (current): user asks a question or requests an edit, SHRIMP responds
- **Triggered** (new): user-configured automations fire when conditions are met (new emails, calendar events, file changes)
- **Scheduled** (new): periodic jobs run on a cron-like schedule (daily digest, weekly summary, inbox triage)

All inference remains 100% local via Ollama. No data leaves the machine. Privacy is a hard constraint, not a preference.

The main UI entry point shifts from "chat interface with a sidebar" to a **dashboard** with a nav rail. Chat becomes the first and most important tool panel, but it sits alongside Email, Obsidian, Jobs, and Notifications.

---

## 2. What Stays the Same vs. What Changes

### Stays the Same

- `npm run web` (browser) / `npm run electron` (desktop) development and deployment model
- FastAPI backend on port 8000, Vite frontend on port 5173
- Ollama for all LLM and embedding work
- LlamaIndex + ChromaDB for RAG indexing
- The `ToolExecutor` pattern: tools are Python functions registered by name, called by the agentic loop
- The sentinel streaming protocol (`__SHRIMP_EDIT__`, `__STAGE__`, `__STAGE_MARKER__`)
- `file_ops.write_accept()` as the sole path for writing files to disk
- `config.py` as the runtime configuration store
- `conversations/` and `projects/` JSON persistence pattern
- React 19 + TypeScript + Tailwind with the existing theme system
- `api.ts` as the single point of contact between frontend and backend

### Changes

- `App.tsx` gets a top-level navigation rail (Dashboard, Chat, Email, Obsidian, Jobs, Notifications)
- `main.py` gains new route groups (`/email/*`, `/notifications/*`, `/jobs/*`, `/obsidian/*`)
- `config.py` gains new sections for email credentials, notification rules, and job schedules
- A new `scheduler.py` module handles background periodic jobs using APScheduler
- A new `email_client.py` module handles IMAP/SMTP
- A new `notifications.py` module persists and manages the notification feed
- The existing `tool_executor.py` gains new tool registrations

---

## 3. Proposed Architecture Changes

### 3.1 Backend Module Structure (After Expansion)

```
backend/
  main.py               # FastAPI routes — new route groups added, existing unchanged
  rag.py                # Unchanged
  file_ops.py           # Unchanged
  config.py             # Extended with email, scheduler, notification config blocks
  conversations.py      # Unchanged
  projects.py           # Unchanged
  tool_executor.py      # Extended with new tool registrations
  email_client.py       # NEW: IMAP fetch, parse, store emails locally
  email_processor.py    # NEW: LLM-driven email triage and action generation
  notifications.py      # NEW: Notification feed (append-only JSON log)
  scheduler.py          # NEW: APScheduler wrapper for periodic jobs
  obsidian_ops.py       # NEW: Obsidian vault operations (search, create, update pages)
  jobs/                 # NEW: Directory of job definitions
    daily_digest.py
    email_triage.py
    news_digest.py
    file_summary.py
    obsidian_maintenance.py
```

### 3.2 New Backend Route Groups

All existing routes remain unchanged. New routes are additive.

**Email routes** (`/email/*`):
- `GET /email/inbox` — return cached inbox items
- `POST /email/fetch` — trigger a manual IMAP fetch
- `POST /email/triage/{email_id}` — run LLM triage on a specific email
- `GET /email/config` — return email connection config (credentials redacted)
- `POST /email/config` — save email connection settings

**Notification routes** (`/notifications/*`):
- `GET /notifications` — return recent notifications (paginated)
- `POST /notifications/{id}/dismiss` — mark notification read
- `DELETE /notifications/{id}` — delete a notification
- `GET /notifications/stream` — SSE stream for live notification push to frontend

**Job routes** (`/jobs/*`):
- `GET /jobs` — list all configured jobs with last-run status
- `POST /jobs/{name}/run` — trigger a job immediately
- `PUT /jobs/{name}` — update schedule or enable/disable a job

**Obsidian routes** (`/obsidian/*`):
- `GET /obsidian/pages` — list all pages in the configured vault scope
- `POST /obsidian/search` — semantic search within vault (wraps existing RAG)
- `POST /obsidian/page` — create or update a page (goes through `file_ops.write_accept()`)

### 3.3 Scheduler Architecture

APScheduler (AsyncIOScheduler) runs in-process alongside FastAPI, started on the existing startup hook:

```python
@app.on_event("startup")
async def startup():
    await loop.run_in_executor(None, projects.migrate_to_projects)
    await loop.run_in_executor(None, rag._hydrate_status)
    await loop.run_in_executor(None, rag.build_all_structural_maps)
    scheduler.start()  # new
```

`scheduler.py` provides:
- `register_job(name, fn, cron_expr)` — add a job
- `get_job_status(name)` — last run time, last result, next run time
- `trigger_job(name)` — run immediately
- All job results written to `notifications.py` to appear in the frontend feed

### 3.4 Notification Feed Architecture

Notifications are append-only JSON lines stored at `notifications/feed.jsonl`. Each notification:

```json
{
  "id": "uuid4",
  "created_at": "ISO8601",
  "read": false,
  "priority": "high | normal | low",
  "type": "email_triage | job_complete | edit_proposed | digest_ready | error",
  "title": "string",
  "body": "string (markdown ok)",
  "actions": [
    {"label": "Open", "route": "/email/inbox?id=xxx"},
    {"label": "Review Edit", "route": "/chat?conversation_id=xxx"}
  ],
  "source": "email_triage | daily_digest | scheduler | chat"
}
```

`GET /notifications/stream` is a long-lived SSE endpoint that fans out new notifications to all connected clients in real time.

### 3.5 Frontend Module Structure (After Expansion)

```
frontend/src/
  App.tsx                       # Restructured: dashboard layout with nav rail
  api.ts                        # Extended with new API calls (additive only)
  components/
    ChatPanel.tsx               # Unchanged
    DiffPanel.tsx               # Unchanged
    MultiFileDiffPanel.tsx      # Unchanged
    SettingsModal.tsx           # Extended with Email and Jobs sections
    ConversationSidebar.tsx     # Unchanged
    ConversationTabs.tsx        # Unchanged
    ScopeSelector.tsx           # Unchanged
    -- NEW --
    DashboardHome.tsx           # Main dashboard landing view
    NotificationFeed.tsx        # Live notification panel (SSE consumer)
    NotificationBadge.tsx       # Header badge showing unread count
    EmailPanel.tsx              # Email inbox browser + triage UI
    EmailDetail.tsx             # Single email reader with streaming triage
    ObsidianPanel.tsx           # Vault browser + create/edit page
    JobsPanel.tsx               # Scheduler status, trigger, configure
  hooks/
    useVisualViewport.ts        # Unchanged
    useNotifications.ts         # NEW: SSE subscription for notification feed
```

### 3.6 Dashboard Layout

`App.tsx` gains a left navigation rail (icon-only on mobile, icon + label on desktop):

| Icon | Label | Panel |
|------|-------|-------|
| 🏠 | Dashboard | `DashboardHome` — landing page with stats and recent activity |
| 💬 | Chat | `ChatPanel` — existing chat, unchanged |
| 📧 | Email | `EmailPanel` — IMAP inbox browser |
| 📓 | Obsidian | `ObsidianPanel` — vault browser |
| ⚙️ | Jobs | `JobsPanel` — scheduler status and controls |
| 🔔 | (bell + badge) | `NotificationFeed` — overlay drawer |

Chat is the default panel. All existing chat behavior is preserved.

---

## 4. Tool/Agent Catalog

### 4.1 Chat Tools (Extensions to tool_executor.py)

New tools registered alongside existing `read_file`, `search_files`, `list_scope`, `propose_file_edit`. Toggleable per-project in Settings.

| Tool | Description |
|------|-------------|
| `fetch_emails(max_count, unread_only, from_filter, subject_filter)` | Read emails from local cache. Answers "what did X send me about Y". |
| `create_obsidian_page(vault_scope, path, content, explanation)` | Create a new vault note with frontmatter, wikilink validation. Goes through `write_accept()`. |
| `update_obsidian_page(vault_scope, path, section, new_content, explanation)` | Update a specific section of an existing vault note using line-based editing. |
| `search_obsidian(query, vault_scope)` | Semantic search restricted to the Obsidian scope. |
| `send_notification(title, body, priority)` | Post a notification to the SHRIMP feed directly from a chat response. |
| `run_shell_command(command, working_dir, timeout_seconds)` | **Opt-in only.** Sandboxed shell execution against a configurable whitelist of allowed commands. |
| `get_calendar_events(days_ahead, calendar_path)` | Read `.ics` files from a configured local calendar directory. |
| `web_fetch(url)` | Fetch and return the readable text content of a URL. Disabled by default. |

### 4.2 Background Agents (jobs/)

Autonomous jobs that run on schedule and post results to the notification feed.

| Job | Schedule | Description |
|-----|----------|-------------|
| **Email Triage** | Every 15 min | Fetches unread emails, classifies urgency, extracts action items, posts notifications. Proposes Obsidian page updates for relevant threads (queued for review, never auto-applied). |
| **Daily Digest** | 8am daily | Gathers unread emails, today's calendar events, recent file changes. Compiles into a Markdown digest and proposes it as a new Obsidian note. |
| **News Digest** | Daily | Fetches configured RSS feeds, LLM-summarizes articles, cross-references with Obsidian vault topics for relevance. Posts digest to notification feed. |
| **File Summary** | On trigger or schedule | Scans a scope for files modified since last run, generates short summaries, appends to `CHANGES.md`. |
| **Obsidian Maintenance** | Weekly | Scans vault for broken wikilinks, orphaned notes, empty notes, notes without tags. Generates a report note and proposes link fixes. |

---

## 5. Email Integration Approach

### 5.1 Architecture Decision: IMAP + Local Store

Direct IMAP access with a local email cache. No Gmail API, no cloud connectors, no OAuth tokens sent to third-party services.

`email_client.py` using `aioimaplib` (async):
1. Fetches message metadata and bodies for unread/recent messages
2. Stores as individual JSON files in `emails/` (mirrors `conversations/` pattern)
3. Body text stripped of HTML using `html2text`
4. Attachments ignored by default (configurable)
5. Credentials stored in `config.py` (consistent with existing local-config security model)

### 5.2 Email Config Block

```python
EMAIL_CONFIG: dict = {
    "enabled": False,
    "imap_host": "",
    "imap_port": 993,
    "imap_ssl": True,
    "username": "",
    "password": "",        # plaintext — same security model as other local config
    "mailbox": "INBOX",
    "fetch_max": 50,
    "poll_interval_minutes": 15,
    "index_in_rag": False, # whether to include email content in ChromaDB
}
```

### 5.3 Privacy Considerations

- Email content never leaves the machine
- `emails/` added to `.gitignore` alongside `config.py`
- Email bodies not indexed into ChromaDB unless `index_in_rag: true`
- Credentials stored as plaintext — document clearly in README as acceptable trade-off for local-only tool
- Alternative: `keyring` Python library for OS-level secret storage (future enhancement)

### 5.4 Email Panel UI

Two-pane layout: email list (left) + `EmailDetail` (right).

Detail view includes:
- Full email text
- **"Triage with AI"** button → `POST /email/triage/{id}` → streams LLM analysis inline (reuses streaming pattern from ChatPanel)
- Action buttons from triage result: "Update Obsidian page X", "Open in Chat", "Draft Reply"

---

## 6. Obsidian Integration Approach

### 6.1 What Already Works

Obsidian vaults are Markdown files on disk. SHRIMP already indexes Markdown files via RAG. The LLM can already read and propose edits to vault notes via existing `read_file` and `propose_file_edit` tools.

The Obsidian integration adds:
1. A dedicated UI panel for vault browsing and note creation
2. Vault-aware tooling (frontmatter, wikilinks, daily notes convention)
3. Smart routing from other agents (email triage → "update this vault page")

### 6.2 obsidian_ops.py Functions

| Function | Description |
|----------|-------------|
| `list_vault_pages(scope)` | Returns pages as a tree respecting Obsidian folder structure |
| `get_page(scope, path)` | Reads a vault page with frontmatter parsing |
| `propose_page_update(scope, path, section_header, new_content, explanation)` | Updates a named section (uses existing line-based editing) |
| `propose_page_create(scope, path, title, tags, content, explanation)` | Creates a new page with proper frontmatter |
| `find_related_pages(query, scope)` | Semantic search restricted to vault scope, returns top 5 |

All write operations go through `file_ops.write_accept()`. No Obsidian plugin required.

### 6.3 Wikilink Awareness

When the LLM proposes a new page, `obsidian_ops.py` scans for `[[link]]` patterns and validates targets against the vault's structural map. Missing links are flagged in the diff explanation text.

### 6.4 Daily Notes Integration

If a Daily Notes folder is configured, the Email Triage Agent appends to today's daily note instead of creating new pages. Format is detected by reading the most recent daily note.

---

## 7. Notification and Dashboard Design

### 7.1 Dashboard Home

- **Notification feed**: recent items from SSE stream, dismissable
- **Quick stats**: unread email count, pending proposals, last job run times
- **Quick actions**: Start Chat, Triage Inbox, Run Daily Digest, Open Vault
- **Recent conversations**: last 5 chats with click-to-open
- **Job status grid**: each job with last run result and next scheduled time

Design philosophy: *information radiator, not control panel.* The dashboard surfaces what needs attention; configuration lives in Settings and the Jobs panel.

### 7.2 Notification Feed

Overlay drawer (similar to `ConversationSidebar`). Notification cards show:
- Source icon (email, job, chat, obsidian)
- Title and truncated body
- Relative timestamp ("2 hours ago")
- Action buttons ("Review Edit", "Open Email", "View Digest")
- Dismiss button

Unread count shown as badge on bell icon. `useNotifications.ts` hook maintains the SSE connection and updates count in real time.

### 7.3 Notification Priority

- **High**: toast overlay (urgent emails, errors)
- **Normal/Low**: visible only in the drawer

---

## 8. Phased Implementation Roadmap

### Phase 1: Foundation (Dashboard Shell + Notifications)

**Goal**: Add dashboard navigation and notification infrastructure without breaking existing chat.

**Backend:**
- `notifications.py` — `append()`, `list()`, `mark_read()`, `delete()`
- `GET /notifications`, `POST /notifications/{id}/dismiss`, `DELETE /notifications/{id}`
- `GET /notifications/stream` — SSE endpoint
- `scheduler.py` — APScheduler wrapper with no-op test job
- `GET /jobs`, `POST /jobs/{name}/run`
- Install `apscheduler` via pip

**Frontend:**
- `App.tsx` — add nav rail; Chat remains default view
- `DashboardHome.tsx` — static placeholder with quick stats
- `NotificationFeed.tsx` — SSE consumer, notification list, dismiss
- `NotificationBadge.tsx` — unread count badge
- `useNotifications.ts` — SSE hook with reconnect

**Done when**: App opens to chat (unchanged). Nav rail visible. Dashboard shows placeholder. Bell icon shows badge. Zero regressions.

---

### Phase 2: Email Integration

**Backend:**
- `email_client.py` — IMAP fetch, local JSON store in `emails/`, HTML stripping
- `email_processor.py` — LLM triage prompt, classification + action extraction
- `/email/*` routes
- `jobs/email_triage.py` — periodic fetch + triage registered with APScheduler
- `fetch_emails` tool in `tool_executor.py`
- `EMAIL_CONFIG` block in `config.py`
- Install `aioimaplib`, `html2text` via pip

**Frontend:**
- `EmailPanel.tsx` — two-pane inbox
- `EmailDetail.tsx` — email reader with streaming triage
- Email nav item
- Email config in `SettingsModal.tsx`

**Done when**: User can configure IMAP, browse inbox, run AI triage, and see results in notification feed.

---

### Phase 3: Obsidian Panel and Daily Digest

**Backend:**
- `obsidian_ops.py` — vault operations (list, parse frontmatter, wikilink validation)
- `/obsidian/*` routes
- `create_obsidian_page`, `update_obsidian_page`, `search_obsidian` tools
- `jobs/daily_digest.py` — morning digest job

**Frontend:**
- `ObsidianPanel.tsx` — vault browser with search and "Open in Chat" per page
- Obsidian nav item

**Done when**: User can browse vault in the Obsidian panel, LLM can propose vault page changes via chat, daily digest runs each morning.

---

### Phase 4: Jobs Dashboard and Additional Agents

**Backend:**
- `jobs/news_digest.py` — RSS fetch, LLM summarize, vault relevance matching
- `jobs/obsidian_maintenance.py` — broken links, orphan detection
- `jobs/file_summary.py` — changed file summaries
- `PUT /jobs/{name}` — schedule editing
- RSS/OPML config in `config.py`
- Install `feedparser` via pip

**Frontend:**
- `JobsPanel.tsx` — job status grid with trigger and schedule controls
- Jobs nav item
- RSS feed config in `SettingsModal.tsx`

**Done when**: All jobs visible and triggerable from UI. User can adjust schedules.

---

### Phase 5: Advanced Tools and Optional Features (ongoing)

- `run_shell_command` tool (opt-in with command whitelist)
- `web_fetch` tool
- `get_calendar_events` tool (ICS file parsing)
- `send_desktop_notification` tool (OS-level via `notify-send` / macOS notifications)
- Electron packaging
- Project templates
- Hardware-based model recommendations

---

## 9. Technical Decisions and Trade-offs

| Decision | Choice | Trade-off |
|----------|--------|-----------|
| **Job scheduler** | APScheduler in-process | No separate broker/process needed; jobs stop if FastAPI dies (acceptable for personal tool) |
| **Email access** | `aioimaplib` + local JSON store | Minimal dependencies; no IMAP IDLE (polling only, not push) |
| **Email credentials** | Plaintext in `config.py` | Consistent with existing config model; could upgrade to OS keyring later |
| **Obsidian access** | Read vault as Markdown directory | No plugin required, works when Obsidian is closed; no awareness of Obsidian-internal metadata |
| **Notification delivery** | SSE (not WebSockets) | Consistent with existing streaming patterns; unidirectional only (fine for notifications) |
| **Phase 1 scope** | Purely additive, zero breaking changes | Slower to deliver email features; ensures existing chat is never regressed |

---

## Critical Files for Implementation

| File | Change |
|------|--------|
| `backend/main.py` | New route groups (`/email/*`, `/notifications/*`, `/jobs/*`); startup hook extended |
| `backend/tool_executor.py` | New tools registered following existing pattern |
| `backend/config.py` | `EMAIL_CONFIG`, RSS feed config, job schedule config blocks added |
| `frontend/src/App.tsx` | Nav rail and panel routing (only structural change to existing frontend) |
| `frontend/src/api.ts` | All new API calls added; existing functions never modified |
| `pip` | Install new Python packages: `apscheduler`, `aioimaplib`, `html2text`, `feedparser` |
