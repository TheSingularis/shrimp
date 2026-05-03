"""APScheduler wrapper for SHRIMP background automations."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable

log = logging.getLogger("shrimp.scheduler")

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.cron import CronTrigger
    _HAS_APSCHEDULER = True
except ImportError:
    _HAS_APSCHEDULER = False
    log.warning("APScheduler not installed — background automations disabled. Install with: pip install apscheduler")

_scheduler: Any = None
_automation_registry: dict[str, dict] = {}  # name → {fn, cron, description, last_run, last_result, enabled, running}
_main_loop: Any = None  # FastAPI event loop, set at startup


def set_main_loop(loop: Any) -> None:
    global _main_loop
    _main_loop = loop


def run_async(coro: Any, timeout: float = 120) -> Any:
    """
    Run an async coroutine from a background thread using the main event loop.
    Avoids creating a new event loop (which breaks 0.0.0.0 routing on this system).
    """
    import asyncio
    if _main_loop is None:
        raise RuntimeError("Main event loop not set — call scheduler.set_main_loop() at startup")
    future = asyncio.run_coroutine_threadsafe(coro, _main_loop)
    return future.result(timeout=timeout)


def start() -> None:
    global _scheduler
    if not _HAS_APSCHEDULER:
        return
    _scheduler = BackgroundScheduler(timezone="UTC")
    _scheduler.start()
    log.info("Scheduler started")

    # Register any automations that were queued before start()
    for name, meta in _automation_registry.items():
        if meta.get("enabled", True):
            _add_to_scheduler(name, meta)


def stop() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None


def register_automation(
    name: str,
    fn: Callable,
    cron: str,
    description: str = "",
    enabled: bool = True,
) -> None:
    """Register a named automation. cron is a 5-field cron expression (minute hour dom month dow)."""
    _automation_registry[name] = {
        "fn": fn,
        "cron": cron,
        "description": description,
        "enabled": enabled,
        "last_run": None,
        "last_result": None,
        "running": False,
    }
    if _scheduler is not None and enabled:
        _add_to_scheduler(name, _automation_registry[name])
    log.info("Registered automation: %s (cron=%s, enabled=%s)", name, cron, enabled)


def _add_to_scheduler(name: str, meta: dict) -> None:
    if not _HAS_APSCHEDULER or _scheduler is None:
        return
    parts = meta["cron"].split()
    if len(parts) != 5:
        log.error("Invalid cron for automation %s: %s", name, meta["cron"])
        return

    def _wrapper():
        log.info("Running automation: %s", name)
        meta["running"] = True
        meta["last_run"] = datetime.now(timezone.utc).isoformat()
        try:
            meta["fn"]()
            meta["last_result"] = "ok"
            log.info("Automation %s completed successfully", name)
        except Exception:
            meta["last_result"] = "error"
            log.exception("Automation %s failed", name)
        finally:
            meta["running"] = False

    minute, hour, dom, month, dow = parts
    trigger = CronTrigger(minute=minute, hour=hour, day=dom, month=month, day_of_week=dow, timezone="UTC")
    _scheduler.add_job(_wrapper, trigger=trigger, id=name, replace_existing=True)


def trigger_automation(name: str) -> bool:
    """Run an automation immediately (fire-and-forget in a thread). Returns False if not found."""
    if name not in _automation_registry:
        return False
    import threading
    meta = _automation_registry[name]

    def _run():
        log.info("Manually triggering automation: %s", name)
        meta["running"] = True
        meta["last_run"] = datetime.now(timezone.utc).isoformat()
        try:
            meta["fn"]()
            meta["last_result"] = "ok"
        except Exception:
            meta["last_result"] = "error"
            log.exception("Manual automation %s failed", name)
        finally:
            meta["running"] = False

    threading.Thread(target=_run, daemon=True).start()
    return True


def set_automation_cron(name: str, cron: str) -> bool:
    """Update the cron schedule for an automation and reschedule it."""
    if name not in _automation_registry:
        return False
    meta = _automation_registry[name]
    meta["cron"] = cron
    if meta.get("enabled", True) and _scheduler is not None and _HAS_APSCHEDULER:
        _add_to_scheduler(name, meta)
    return True


def set_automation_enabled(name: str, enabled: bool) -> bool:
    if name not in _automation_registry:
        return False
    meta = _automation_registry[name]
    meta["enabled"] = enabled
    if _scheduler is not None and _HAS_APSCHEDULER:
        if enabled:
            _add_to_scheduler(name, meta)
        else:
            try:
                _scheduler.remove_job(name)
            except Exception:
                pass
    return True


def set_automation_progress(name: str, progress: dict | None) -> None:
    meta = _automation_registry.get(name)
    if meta is not None:
        meta["progress"] = progress


def _automation_dict(name: str, meta: dict) -> dict:
    return {
        "name": name,
        "description": meta.get("description", ""),
        "cron": meta.get("cron", ""),
        "enabled": meta.get("enabled", True),
        "last_run": meta.get("last_run"),
        "last_result": meta.get("last_result"),
        "running": meta.get("running", False),
        "progress": meta.get("progress"),
    }


def get_automations() -> list[dict]:
    return [_automation_dict(name, meta) for name, meta in _automation_registry.items()]


def get_automation(name: str) -> dict | None:
    meta = _automation_registry.get(name)
    if meta is None:
        return None
    return _automation_dict(name, meta)
