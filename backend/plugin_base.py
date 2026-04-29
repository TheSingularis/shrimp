"""
Base classes for SHRIMP plugins.

Every plugin exposes a singleton instance of ShrimpPlugin (conventionally
named `plugin`) from its backend/__init__.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from fastapi import APIRouter


@dataclass
class PluginJob:
    """A scheduled automation job provided by a plugin."""
    name: str
    fn: Callable           # sync def — APScheduler calls this in a thread
    cron: str              # 5-field cron expression: minute hour dom month dow
    description: str = ""
    enabled_default: bool = True
    # Pre-override default. Once the user saves a state via AutomationsPanel,
    # AUTOMATION_CONFIG in config.py takes permanent precedence over this value.


class ShrimpPlugin:
    """Base class for all SHRIMP plugins.

    Subclass this and set the class-level attributes, then expose a module-level
    ``plugin = MyPlugin()`` singleton in your backend/__init__.py.
    """

    id: str = ""
    name: str = ""
    category: str = "community"  # "core" | "community"

    # ── override these ──────────────────────────────────────────────────────

    def get_router(self) -> "APIRouter | None":
        """Return a FastAPI APIRouter whose routes will be mounted on the app."""
        return None

    async def on_startup(self) -> None:
        """Called once during FastAPI startup, after routes are mounted."""
        pass

    async def on_shutdown(self) -> None:
        """Called once during FastAPI shutdown."""
        pass

    def get_jobs(self) -> list[PluginJob]:
        """Return PluginJob instances to register with the global scheduler."""
        return []
