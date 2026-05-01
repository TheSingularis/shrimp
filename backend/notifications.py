"""Notification feed — append-only JSONL store with SSE fan-out."""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from config_utils import get_data_dir

log = logging.getLogger("shrimp.notifications")

_FEED_PATH = get_data_dir() / "notifications" / "feed.jsonl"
_FEED_PATH.parent.mkdir(parents=True, exist_ok=True)

# SSE subscribers: each entry is a queue.Queue that receives notification dicts
_subscribers: list[Any] = []


# ── data model ────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make(
    title: str,
    body: str,
    type: str = "info",
    priority: str = "normal",
    source: str = "system",
    actions: list[dict] | None = None,
) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "created_at": _now(),
        "read": False,
        "priority": priority,
        "type": type,
        "title": title,
        "body": body,
        "actions": actions or [],
        "source": source,
    }


# ── persistence ───────────────────────────────────────────────────────────────

def append(
    title: str,
    body: str,
    type: str = "info",
    priority: str = "normal",
    source: str = "system",
    actions: list[dict] | None = None,
) -> dict:
    """Create and persist a notification; fan out to SSE subscribers."""
    notif = _make(title, body, type, priority, source, actions)
    try:
        with _FEED_PATH.open("a") as f:
            f.write(json.dumps(notif) + "\n")
    except Exception:
        log.exception("Failed to write notification to feed")

    # Fan out to all SSE subscribers
    dead: list[Any] = []
    for q in _subscribers:
        try:
            q.put_nowait(notif)
        except Exception:
            dead.append(q)
    for q in dead:
        _subscribers.remove(q)

    return notif


def list_notifications(limit: int = 50, include_read: bool = True) -> list[dict]:
    """Return notifications newest-first."""
    if not _FEED_PATH.exists():
        return []
    lines: list[dict] = []
    try:
        with _FEED_PATH.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    lines.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    except Exception:
        log.exception("Failed to read notification feed")
        return []
    if not include_read:
        lines = [n for n in lines if not n.get("read")]
    lines.sort(key=lambda n: n.get("created_at", ""), reverse=True)
    return lines[:limit]


def mark_read(notification_id: str) -> bool:
    """Mark a notification as read. Returns True if found."""
    return _update(notification_id, {"read": True})


def delete(notification_id: str) -> bool:
    """Delete a notification. Returns True if found."""
    if not _FEED_PATH.exists():
        return False
    lines: list[dict] = []
    found = False
    try:
        with _FEED_PATH.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    n = json.loads(line)
                    if n.get("id") == notification_id:
                        found = True
                    else:
                        lines.append(n)
                except json.JSONDecodeError:
                    pass
        with _FEED_PATH.open("w") as f:
            for n in lines:
                f.write(json.dumps(n) + "\n")
    except Exception:
        log.exception("Failed to delete notification")
    return found


def unread_count() -> int:
    return sum(1 for n in list_notifications(limit=1000) if not n.get("read"))


def subscribe() -> Any:
    """Register a new SSE subscriber queue. Caller must call unsubscribe() on disconnect."""
    import queue as q_mod
    q: Any = q_mod.Queue()
    _subscribers.append(q)
    return q


def unsubscribe(q: Any) -> None:
    try:
        _subscribers.remove(q)
    except ValueError:
        pass


# ── internal helpers ──────────────────────────────────────────────────────────

def _update(notification_id: str, updates: dict) -> bool:
    if not _FEED_PATH.exists():
        return False
    lines: list[dict] = []
    found = False
    try:
        with _FEED_PATH.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    n = json.loads(line)
                    if n.get("id") == notification_id:
                        n.update(updates)
                        found = True
                    lines.append(n)
                except json.JSONDecodeError:
                    pass
        with _FEED_PATH.open("w") as f:
            for n in lines:
                f.write(json.dumps(n) + "\n")
    except Exception:
        log.exception("Failed to update notification")
    return found
