# SHRIMP Codebase Inconsistencies & Refactors

Living document. Add entries as new inconsistencies are found. Mark with ✅ when fixed.

---

## ✅ R1 — Renamed duplicate `debug_prompt` function name

**What:** `main.py` had two functions named `debug_prompt` — one for `GET /debug/prompt` and one for `POST /debug/prompt`. Python allows this but it's a silent name collision (the second definition wins at the module level), which breaks IDE navigation, `from main import debug_prompt`, and static analysis.

**Where:** `backend/main.py:343`

**Fix:** Renamed the POST handler to `debug_post_prompt`. Both routes still work correctly — FastAPI registers routes by decorator, not function name.

---

## ✅ R2 — Aliased duplicate scope routes

**What:** `GET /scopes` (line 1654) and `GET /settings/scopes` (line 1659) contained identical logic — both returned `config.WATCHED_DIRS`. Two copies means two places to update when the format changes.

**Where:** `backend/main.py:1659`

**Fix:** Replaced the body of `get_settings_scopes()` with `return await get_scopes()`. The URL is preserved for compatibility.

---

## ✅ R3 — Documented `PluginJob.enabled_default` semantics

**What:** `email` and `news` plugins use different heuristics for `enabled_default`:
- Email: `_config.EMAIL_CONFIG.get("enabled", False)` — reads explicit config flag
- News: `bool(getattr(_config, "RSS_FEEDS", []))` — truthy-checks the feeds list

Neither is wrong, but without documentation it looks like a bug. The key insight is that `enabled_default` is only a *pre-override* default — once the user has interacted with AutomationsPanel, `AUTOMATION_CONFIG` takes precedence permanently.

**Where:** `backend/plugin_base.py:PluginJob.enabled_default`

**Fix:** Added docstring to `PluginJob.enabled_default` clarifying the precedence rule.

---

## ✅ R4 — Atomic config writes

**What:** All config persistence used `Path.write_text()` directly. A crash mid-write would corrupt `config.py` and prevent startup.

**Fix:** Added `backend/config_utils.py` with `atomic_write(path, content)` using `tempfile.NamedTemporaryFile` + `os.replace()`. Replaced all 14 call sites across `main.py`, `plugins/email/backend/__init__.py`, and `plugins/news/backend/__init__.py`.

---


---

## ✅ R5 — Normalized email fetch response envelopes

**What:** `POST /plugins/email/fetch` returned `{"fetched": N, "emails": [...]}` while `POST /plugins/email/fetch/{folder}` returned `{"fetched": N, "folder": ..., "message": ...}`. Frontend never consumed `emails` or `message` — it only reads `.fetched`.

**Fix:** Both routes now return `{"fetched": N, "folder": str}`. Removed the unused `emails` list (saves serializing the full email payload on every manual fetch) and the internal `message` string.

---

---

## Pending — `asyncio.run()` ban not enforced

**What:** All automation jobs must use `scheduler.run_async()` for async operations. This is documented in `PLUGINS.md` and enforced by convention, but nothing in the codebase prevents a future plugin from calling `asyncio.run()` directly, which would silently break socket binding on this system.

**Where:** Convention, no enforcement point.

**Risk:** Low (discovery failure). Easy to debug from logs but confusing.

**Recommended fix:** Add a check in `scheduler.run_async()` that logs a warning if called from the main thread (where `asyncio.run()` would be fine), and separately add a guard in `_wrapper()`:
```python
# In _wrapper() inside _add_to_scheduler():
import asyncio
if asyncio.get_event_loop_policy().get_event_loop().is_running():
    # We're in a thread — asyncio.run() would fail here
    pass  # run_async() must be used
```
Or simply run a linter rule / grep in CI for `asyncio.run(` in `plugins/*/backend/`.
