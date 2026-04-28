# SHRIMP Plugin System — Refactor Plan

## Goal

Introduce a plugin architecture (Obsidian/VSCode style) where features can be packaged as self-contained plugins that register backend routes, scheduler jobs, frontend panels, dashboard cards, and settings sections. The email system is the first "Core" plugin extracted from the monolith.

---

## Principles

- **Top-level `plugins/` directory** — each plugin is a folder at the repo root, alongside `backend/` and `frontend/`. Easy to install by dropping a folder.
- **Core plugins** get first-class treatment: top-level settings tabs, can ship in-repo.
- **Third-party plugins** land under a "Plugins" tab in settings; same API contract, different install path.
- **Automations remain global** — the scheduler is a core service. Plugins register jobs into it.
- **Dynamic loading** — backend mounts plugin routes at runtime. Frontend uses Vite's `import.meta.glob` for lazy per-plugin chunk loading. In dev (Vite HMR) new plugin files are picked up automatically; a page refresh triggers the new plugin UI.

---

## Directory Layout

```
plugins/
  email/
    plugin.json                   # manifest
    backend/
      __init__.py                 # EmailPlugin(ShrimpPlugin) singleton
      email_client.py             <- moved from backend/
      email_processor.py          <- moved from backend/
      email_smtp.py               <- moved from backend/
      email_sync.py               <- moved from backend/
      automations/
        email_triage.py           <- moved from backend/automations/
        daily_digest.py           <- moved from backend/automations/
    frontend/
      index.tsx                   # default export: EmailPluginFrontend
      EmailPanel.tsx              <- moved from frontend/src/components/
      EmailDetail.tsx             <- moved from frontend/src/components/
      ComposeModal.tsx            <- moved from frontend/src/components/
      DashboardCard.tsx           # new — extracted from DashboardHome.tsx
      SettingsSection.tsx         # new — extracted from SettingsModal.tsx
      api.ts                      # new — email-specific API calls
      types.ts                    # new — EmailMeta, EmailConfig, etc.
```

---

## Backend Architecture

### `backend/plugin_base.py` (new)

```python
class PluginJob:
    name: str
    description: str
    cron: str
    run: Callable        # sync def — scheduler calls in a thread
    enabled_default: bool

class ShrimpPlugin:
    id: str = ""
    name: str = ""
    category: str = "community"   # "core" | "community"

    def get_router(self) -> APIRouter | None: ...
    async def on_startup(self) -> None: ...
    async def on_shutdown(self) -> None: ...
    def get_jobs(self) -> list[PluginJob]: ...
```

### `backend/plugin_loader.py` (new)

Responsibilities:
- Scan `plugins/*/plugin.json` on startup
- `sys.path`-inject `plugins/<id>/` so `from backend import ...` works inside plugin
- Import `plugins/<id>/backend/__init__.py`, call `plugin` singleton
- Mount plugin router at `/plugins/<id>/`
- Register plugin jobs with scheduler
- Expose `GET /api/plugins` (list of manifests + enabled state)
- Expose `POST /api/plugins/install` (drop archive, register dynamically)
- Expose `POST /api/plugins/{id}/enable` / `disable`

### `plugins/email/backend/__init__.py`

```python
from plugin_base import ShrimpPlugin, PluginJob
from fastapi import APIRouter

router = APIRouter(prefix="/email", tags=["email"])
# ... all current email routes imported here from email_client, etc.

class EmailPlugin(ShrimpPlugin):
    id = "email"
    name = "Email"
    category = "core"

    def get_router(self): return router
    async def on_startup(self):
        import email_sync; email_sync.start()
        # deduplicate / embed backfill threads
    async def on_shutdown(self):
        import email_sync; email_sync.stop()
    def get_jobs(self):
        from automations.email_triage import run as triage_run
        from automations.daily_digest import run as digest_run
        return [
            PluginJob("email_triage", "...", f"*/{poll_mins} * * * *", triage_run, enabled_default=...),
            PluginJob("daily_digest", "...", "0 8 * * *", digest_run, True),
        ]

plugin = EmailPlugin()
```

### `main.py` changes (minimal)

- Remove all direct email imports (`email_client`, `email_processor`, `email_smtp`, `email_sync`)
- Remove email route definitions (they move to plugin router)
- Remove email job registration from `startup()` (handled by plugin loader)
- Add `plugin_loader.discover()` call in `startup()`
- Add `app.include_router(plugin_loader.get_router())` for plugin management API

### What stays in core backend (does NOT move)

```
backend/main.py          rag.py           conversations.py
backend/projects.py      notifications.py scheduler.py
backend/file_ops.py      config.py        tool_executor.py
backend/checklist.py     obsidian_ops.py
backend/automations/obsidian_maintenance.py
backend/automations/news_digest.py
```

---

## Frontend Architecture

### New files

```
frontend/src/plugins/types.ts       # ShrimpPluginFrontend interface
frontend/src/plugins/context.tsx    # PluginContext + PluginProvider
frontend/src/plugins/loader.ts      # import.meta.glob discovery
```

### `frontend/src/plugins/types.ts`

```tsx
export type NavigateFn = (panel: string, emailId?: string, conversationId?: string) => void;

export interface PluginNavItem {
  icon: React.ComponentType<{ size?: number }>
  label: string
  getBadge?: () => number
}

export interface ShrimpPluginFrontend {
  id: string
  navItem?: PluginNavItem
  PanelComponent: React.ComponentType<{ onNavigate: NavigateFn }>
  DashboardCards?: React.ComponentType<{ onNavigate: NavigateFn }>[]
  SettingsSection?: React.ComponentType
  settingsLevel?: "top-level" | "plugin-page"    // mirrors plugin.json
}
```

### `frontend/src/plugins/loader.ts`

```ts
// Vite resolves all matching paths at build time; lazy-loads each chunk on demand
const pluginModules = import.meta.glob('/plugins/*/frontend/index.tsx')

export async function loadPlugins(enabledIds: string[]): Promise<ShrimpPluginFrontend[]> {
  const results: ShrimpPluginFrontend[] = []
  for (const id of enabledIds) {
    const key = `/plugins/${id}/frontend/index.tsx`
    if (pluginModules[key]) {
      const mod = await pluginModules[key]() as { default: ShrimpPluginFrontend }
      results.push(mod.default)
    }
  }
  return results
}
```

### `frontend/src/plugins/context.tsx`

```tsx
const PluginContext = createContext<ShrimpPluginFrontend[]>([])

export function PluginProvider({ children }) {
  const [plugins, setPlugins] = useState<ShrimpPluginFrontend[]>([])
  useEffect(() => {
    fetch('/api/plugins')
      .then(r => r.json())
      .then(data => loadPlugins(data.enabled.map(p => p.id)))
      .then(setPlugins)
  }, [])
  return <PluginContext.Provider value={plugins}>{children}</PluginContext.Provider>
}

export const usePlugins = () => useContext(PluginContext)
```

### `App.tsx` changes

- Wrap app in `<PluginProvider>`
- `Panel` type becomes `string` (core panels + plugin ids)
- Nav rail: render plugin `navItem` entries from `usePlugins()` after core items
- Panel routing: check plugins first, fall back to core panels
- Dashboard: pass plugin `DashboardCards` down to `DashboardHome`

```tsx
// Nav items — core hardcoded + plugin-driven
const pluginNavItems = plugins
  .filter(p => p.navItem)
  .map(p => ({ panel: p.id, ...p.navItem! }))

// Panel rendering — dynamic
const activePlugin = plugins.find(p => p.id === activePanel)
// in <main>:
{activePlugin
  ? <activePlugin.PanelComponent onNavigate={handleNavigate} />
  : /* existing core panel switch */}
```

### `DashboardHome.tsx` changes

- Accepts `plugins: ShrimpPluginFrontend[]` prop
- Renders `plugin.DashboardCards` for each plugin alongside core cards
- Email sections (`EmailSection`, `FlaggedSection`) move entirely to `plugins/email/frontend/DashboardCard.tsx`

### `SettingsModal.tsx` changes

- `TabType` no longer hardcodes `"email"` — tabs are partially dynamic
- Core tabs stay: `appearance | models | scopes | advanced`
- For each plugin with `settingsLevel === "top-level"`: inject a tab before "Plugins"
- New `"plugins"` tab: lists community plugins with their `SettingsSection`

---

## `plugin.json` manifest format

```json
{
  "id": "email",
  "name": "Email",
  "version": "1.0.0",
  "category": "core",
  "description": "IMAP/SMTP email client with AI triage and digest",
  "min_shrimp_version": "1.0.0",
  "settings_level": "top-level"
}
```

Fields:
- `category`: `"core"` (ships in-repo) | `"community"` (third-party install)
- `settings_level`: `"top-level"` (own tab in modal) | `"plugin-page"` (under Plugins tab)

---

## Implementation Phases

### Phase 0 — Plugin Infrastructure (no file moves, all additive)

**Backend**
- [ ] `backend/plugin_base.py` — `ShrimpPlugin`, `PluginJob` base classes
- [ ] `backend/plugin_loader.py` — discovery, sys.path injection, route mounting, job registration
- [ ] `GET /api/plugins` in `main.py` — returns manifest list + enabled state
- [ ] `main.py` startup calls `plugin_loader.discover()`

**Frontend**
- [ ] `frontend/src/plugins/types.ts`
- [ ] `frontend/src/plugins/loader.ts`
- [ ] `frontend/src/plugins/context.tsx` (PluginProvider + usePlugins)
- [ ] Wrap `App.tsx` in `<PluginProvider>` — verify no regressions

---

### Phase 1 — Email Plugin Backend

- [ ] `plugins/email/plugin.json`
- [ ] Move `backend/email_client.py` → `plugins/email/backend/email_client.py`
- [ ] Move `backend/email_processor.py` → `plugins/email/backend/email_processor.py`
- [ ] Move `backend/email_smtp.py` → `plugins/email/backend/email_smtp.py`
- [ ] Move `backend/email_sync.py` → `plugins/email/backend/email_sync.py`
- [ ] Move `backend/automations/email_triage.py` → `plugins/email/backend/automations/email_triage.py`
- [ ] Move `backend/automations/daily_digest.py` → `plugins/email/backend/automations/daily_digest.py`
- [ ] Create `plugins/email/backend/__init__.py` with `EmailPlugin`
- [ ] Strip all email routes from `main.py` — move into plugin router
- [ ] Strip email startup/shutdown from `main.py` — moved to `EmailPlugin.on_startup/on_shutdown`
- [ ] Strip email job registration from `main.py` — moved to `EmailPlugin.get_jobs()`
- [ ] Verify: backend starts, email routes respond at `/plugins/email/...`

---

### Phase 2 — Email Plugin Frontend

- [ ] Move `frontend/src/components/EmailPanel.tsx` → `plugins/email/frontend/EmailPanel.tsx`
- [ ] Move `frontend/src/components/EmailDetail.tsx` → `plugins/email/frontend/EmailDetail.tsx`
- [ ] Move `frontend/src/components/ComposeModal.tsx` → `plugins/email/frontend/ComposeModal.tsx`
- [ ] Create `plugins/email/frontend/api.ts` — email API calls (previously in `frontend/src/api.ts`)
- [ ] Create `plugins/email/frontend/types.ts` — `EmailMeta`, `EmailConfig`, `SmtpConfig`, etc.
- [ ] Extract `EmailSection` + `FlaggedSection` from `DashboardHome.tsx` → `plugins/email/frontend/DashboardCard.tsx`
- [ ] Extract email settings tab content from `SettingsModal.tsx` → `plugins/email/frontend/SettingsSection.tsx`
- [ ] Create `plugins/email/frontend/index.tsx` — `EmailPluginFrontend` default export
- [ ] Update `DashboardHome.tsx` — accepts plugin cards via props, renders them
- [ ] Update `App.tsx` — email nav item and panel come from plugin registry
- [ ] Update `SettingsModal.tsx` — email tab comes from plugin registry
- [ ] Verify: full email flow works end-to-end through plugin system

---

### Phase 3 — Settings & Plugin Management UI

- [ ] Add `"plugins"` tab to `SettingsModal.tsx`
- [ ] Plugin management tab: list installed plugins, enable/disable, show version/description
- [ ] Community plugin install flow (drop folder → `POST /api/plugins/install`)
- [ ] `POST /api/plugins/{id}/enable` / `disable` endpoints
- [ ] Frontend hot-reload on plugin install (fetch updated registry, re-run `loadPlugins()`)

---

## API URL Changes

When email moves to the plugin router, API paths change:

| Before | After |
|--------|-------|
| `GET /inbox` | `GET /plugins/email/inbox` |
| `GET /email/{id}` | `GET /plugins/email/{id}` |
| `POST /email/{id}/reply` | `POST /plugins/email/{id}/reply` |
| `POST /send-email` | `POST /plugins/email/send` |
| `GET /email-config` | `GET /plugins/email/config` |
| `POST /email-config` | `POST /plugins/email/config` |
| ... all email routes | ... all under `/plugins/email/` |

Frontend `api.ts` email functions update their base path accordingly (or move to `plugins/email/frontend/api.ts`).

---

## What Does NOT Change

The following are core and never become plugins:

- Chat / RAG / streaming (`/chat`, `rag.py`, `tool_executor.py`)
- Conversations + Projects
- Notifications + Scheduler
- File operations (`file_ops.py`)
- Config system (`config.py`)
- Checklist (`checklist.py`, `DailyChecklist.tsx`)
- Obsidian panel (`obsidian_ops.py`, `ObsidianPanel.tsx`) — candidate for future plugin
- News digest (`automations/news_digest.py`) — candidate for future plugin

---

## Testing Checkpoints (per phase)

**Phase 0**: `GET /api/plugins` returns `[]`, app loads without errors, no visual change.

**Phase 1**: All email API endpoints respond correctly at new paths. Backend log shows plugin loaded. `email_sync` starts. Jobs registered in scheduler.

**Phase 2**: Email panel renders, compose/reply works, dashboard email cards render, settings email tab visible. `npx tsc --noEmit` passes.

**Phase 3**: Enable/disable plugin persists across restart. Installing a plugin folder + calling install endpoint makes it appear in UI on reload.
