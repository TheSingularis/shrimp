"""
Plugin discovery, loading, and lifecycle management for SHRIMP.

Plugins live in {repo_root}/plugins/<id>/  (one level above backend/).
Each plugin directory must contain a plugin.json manifest.
If it has a backend/ subdirectory with an __init__.py, that module is loaded
and its ``plugin`` singleton (a ShrimpPlugin subclass) is registered.
"""
from __future__ import annotations

import importlib.util
import json
import logging
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI
    from plugin_base import ShrimpPlugin

log = logging.getLogger("shrimp.plugin_loader")

# plugins/ is one directory above backend/
PLUGINS_DIR = Path(__file__).parent.parent / "plugins"

_registry: dict[str, "ShrimpPlugin | None"] = {}   # id → plugin (None = frontend-only)
_manifests: dict[str, dict] = {}                   # id → parsed plugin.json


# ── discovery ────────────────────────────────────────────────────────────────


def discover() -> None:
    """Scan PLUGINS_DIR and load every plugin that has a plugin.json."""
    if not PLUGINS_DIR.exists():
        log.info("No plugins/ directory found — skipping plugin discovery")
        return

    for plugin_dir in sorted(PLUGINS_DIR.iterdir()):
        if not plugin_dir.is_dir():
            continue
        if not (plugin_dir / "plugin.json").exists():
            continue
        try:
            load(plugin_dir.name)
        except Exception:
            log.exception("Failed to load plugin '%s'", plugin_dir.name)


def load(plugin_id: str) -> "ShrimpPlugin | None":
    """Load a single plugin by id.

    Adds plugins/<id>/backend/ to sys.path so the plugin's modules can be
    imported with plain ``import email_client`` style statements, while
    backend/ (already on sys.path) remains accessible for ``import config`` etc.
    """
    plugin_dir = PLUGINS_DIR / plugin_id
    manifest_path = plugin_dir / "plugin.json"
    backend_dir = plugin_dir / "backend"

    if not manifest_path.exists():
        raise FileNotFoundError(f"No plugin.json for plugin '{plugin_id}'")

    manifest = json.loads(manifest_path.read_text())
    _manifests[plugin_id] = manifest

    if not backend_dir.exists() or not (backend_dir / "__init__.py").exists():
        log.info("Plugin '%s' has no backend — frontend-only plugin", plugin_id)
        _registry[plugin_id] = None
        return None

    # Prepend plugin backend to sys.path for flat module imports within the plugin
    backend_str = str(backend_dir)
    if backend_str not in sys.path:
        sys.path.insert(0, backend_str)

    # Load the plugin's backend package under a unique module name to avoid collisions
    module_name = f"_plugin_backend_{plugin_id}"
    if module_name in sys.modules:
        module = sys.modules[module_name]
    else:
        spec = importlib.util.spec_from_file_location(
            module_name, backend_dir / "__init__.py",
            submodule_search_locations=[str(backend_dir)],
        )
        if spec is None or spec.loader is None:
            raise ImportError(f"Cannot load plugin backend for '{plugin_id}'")
        module = importlib.util.module_from_spec(spec)
        sys.modules[module_name] = module
        spec.loader.exec_module(module)  # type: ignore[union-attr]

    plugin: ShrimpPlugin = module.plugin
    _registry[plugin_id] = plugin
    log.info("Loaded plugin: %s v%s", plugin.name, manifest.get("version", "?"))
    return plugin


# ── accessors ────────────────────────────────────────────────────────────────


def get_all() -> list["ShrimpPlugin"]:
    """Return all loaded backend plugins (excludes frontend-only)."""
    return [p for p in _registry.values() if p is not None]


def get(plugin_id: str) -> "ShrimpPlugin | None":
    return _registry.get(plugin_id)


def get_manifests() -> list[dict]:
    return list(_manifests.values())


# ── app integration ──────────────────────────────────────────────────────────


def include_routers(app: "FastAPI") -> None:
    """Mount each plugin's APIRouter on the FastAPI app.

    Call this at module level in main.py (after app creation, before first
    request) so routes are compiled into the app before Uvicorn starts.
    """
    for plugin in get_all():
        router = plugin.get_router()
        if router is not None:
            app.include_router(router)
            log.info("Mounted router for plugin '%s'", plugin.id)


def register_all_jobs() -> None:
    """Register all plugin jobs with the global scheduler.

    Call this inside the FastAPI startup handler, before scheduler.start().
    Reads AUTOMATION_CONFIG overrides from config to honour saved schedules.
    """
    import config
    import scheduler

    for plugin in get_all():
        for job in plugin.get_jobs():
            overrides = getattr(config, "AUTOMATION_CONFIG", {}).get(job.name, {})
            cron = overrides.get("cron", job.cron)
            enabled = overrides.get("enabled", job.enabled_default)
            scheduler.register_automation(
                job.name,
                job.fn,
                cron=cron,
                description=job.description,
                enabled=enabled,
            )


# ── lifecycle ────────────────────────────────────────────────────────────────


async def startup_all() -> None:
    """Call on_startup() on every loaded plugin. Errors are logged, not raised."""
    for plugin in get_all():
        try:
            await plugin.on_startup()
        except Exception:
            log.exception("Plugin '%s' on_startup failed", plugin.id)


async def shutdown_all() -> None:
    """Call on_shutdown() on every loaded plugin. Errors are logged, not raised."""
    for plugin in get_all():
        try:
            await plugin.on_shutdown()
        except Exception:
            log.exception("Plugin '%s' on_shutdown failed", plugin.id)
