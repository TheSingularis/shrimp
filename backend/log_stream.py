"""
SSE log broadcast — streams shrimp.* log records to subscribed clients.

Usage:
    from log_stream import log_event_generator
    # in a FastAPI route: EventSourceResponse(log_event_generator(request))
"""
from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator

_subscribers: list[asyncio.Queue[str | None]] = []


class _BroadcastHandler(logging.Handler):
    """Puts formatted log records onto every active subscriber queue."""

    def emit(self, record: logging.LogRecord) -> None:
        msg = self.format(record)
        dead: list[asyncio.Queue[str | None]] = []
        for q in list(_subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            try:
                _subscribers.remove(q)
            except ValueError:
                pass


_handler = _BroadcastHandler()
_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%H:%M:%S"))

# Attach to the root shrimp logger so all shrimp.* loggers inherit it
logging.getLogger("shrimp").addHandler(_handler)


async def log_event_generator(request) -> AsyncIterator[dict]:  # type: ignore[type-arg]
    """Async generator for use with EventSourceResponse."""
    q: asyncio.Queue[str | None] = asyncio.Queue(maxsize=200)
    _subscribers.append(q)
    try:
        while True:
            if await request.is_disconnected():
                break
            try:
                msg = await asyncio.wait_for(q.get(), timeout=15)
            except asyncio.TimeoutError:
                yield {"event": "ping", "data": ""}
                continue
            if msg is None:
                break
            yield {"data": msg}
    finally:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass
