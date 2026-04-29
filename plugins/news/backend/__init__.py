"""
News plugin for SHRIMP.

Provides RSS feed management, AI interest filtering, and daily news digest
automation. All routes are mounted under /plugins/news/ by the plugin loader.
"""
from __future__ import annotations

import inspect
import json
import logging
import re as _re
from pathlib import Path

import config as _config
from config_utils import atomic_write as _atomic_write
from fastapi import APIRouter
from pydantic import BaseModel

from plugin_base import ShrimpPlugin, PluginJob

log = logging.getLogger("shrimp.plugin.news")

_CONFIG_PATH = Path(inspect.getfile(_config))

router = APIRouter(prefix="/plugins/news", tags=["news"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class FeedsUpdate(BaseModel):
    feeds: list[dict]


class InterestsUpdate(BaseModel):
    interests: str
    strictness: str = "focused"  # "broad" | "focused" | "strict"


# ── Config write helpers ──────────────────────────────────────────────────────

def _write_feeds(feeds: list[dict]) -> None:
    current = _CONFIG_PATH.read_text()
    new_val = json.dumps(feeds)
    if _re.search(r"RSS_FEEDS: list\[dict\] = \[.*?\]", current, _re.DOTALL):
        current = _re.sub(
            r"RSS_FEEDS: list\[dict\] = \[.*?\]",
            f"RSS_FEEDS: list[dict] = {new_val}",
            current,
            flags=_re.DOTALL,
        )
    else:
        current += f"\nRSS_FEEDS: list[dict] = {new_val}\n"
    _atomic_write(_CONFIG_PATH, current)


def _write_interests(interests: str) -> None:
    current = _CONFIG_PATH.read_text()
    safe = interests.replace('"""', '\\"\\"\\"')
    replacement = f'NEWS_INTERESTS: str = """{safe}"""'
    if _re.search(r'NEWS_INTERESTS: str = """.*?"""', current, _re.DOTALL):
        current = _re.sub(r'NEWS_INTERESTS: str = """.*?"""', replacement, current, flags=_re.DOTALL)
    elif _re.search(r'NEWS_INTERESTS: str = ".*?"', current, _re.DOTALL):
        current = _re.sub(r'NEWS_INTERESTS: str = ".*?"', replacement, current, flags=_re.DOTALL)
    else:
        current += f'\n{replacement}\n'
    _atomic_write(_CONFIG_PATH, current)


def _write_strictness(strictness: str) -> None:
    current = _CONFIG_PATH.read_text()
    replacement = f'NEWS_FILTER_STRICTNESS: str = "{strictness}"'
    if _re.search(r'NEWS_FILTER_STRICTNESS: str = ".*?"', current):
        current = _re.sub(r'NEWS_FILTER_STRICTNESS: str = ".*?"', replacement, current)
    else:
        current += f'\n{replacement}\n'
    _atomic_write(_CONFIG_PATH, current)


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/feeds")
async def get_feeds():
    return {"feeds": getattr(_config, "RSS_FEEDS", [])}


@router.post("/feeds")
async def set_feeds(update: FeedsUpdate):
    _config.RSS_FEEDS = update.feeds
    _write_feeds(update.feeds)
    return {"feeds": _config.RSS_FEEDS}


@router.get("/interests")
async def get_interests():
    return {
        "interests": getattr(_config, "NEWS_INTERESTS", ""),
        "strictness": getattr(_config, "NEWS_FILTER_STRICTNESS", "focused"),
    }


@router.post("/interests")
async def set_interests(update: InterestsUpdate):
    valid = {"broad", "focused", "strict"}
    strictness = update.strictness if update.strictness in valid else "focused"
    _config.NEWS_INTERESTS = update.interests
    _config.NEWS_FILTER_STRICTNESS = strictness
    _write_interests(update.interests)
    _write_strictness(strictness)
    return {
        "interests": _config.NEWS_INTERESTS,
        "strictness": _config.NEWS_FILTER_STRICTNESS,
    }


# ── Plugin class ──────────────────────────────────────────────────────────────

class NewsPlugin(ShrimpPlugin):
    id = "news"
    name = "News"
    category = "core"

    def get_router(self):
        return router

    def get_jobs(self) -> list[PluginJob]:
        from news_digest import run as _run
        return [
            PluginJob(
                name="news_digest",
                fn=_run,
                cron="0 9 * * *",
                description="Fetch RSS feeds and add new articles to checklist",
                enabled_default=bool(getattr(_config, "RSS_FEEDS", [])),
            ),
        ]


plugin = NewsPlugin()
