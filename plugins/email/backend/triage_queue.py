"""
Single async queue for email triage.

All triage calls — IDLE push, sync, backfill, and manual button — funnel
through here. One email is processed at a time (Ollama is serial anyway).
STAGGER adds optional dead-time between emails; default 0.
"""
from __future__ import annotations

import asyncio
import collections
import logging
import threading

import email_processor

log = logging.getLogger("shrimp.triage_queue")


class TriageQueue:
    STAGGER = 0  # seconds between emails; raise to throttle Ollama

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._priority: collections.deque[str] = collections.deque()
        self._normal: collections.deque[str] = collections.deque()
        self._queued: set[str] = set()
        self._processing: str | None = None
        self._waiters: dict[str, list[asyncio.Future]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self._event: asyncio.Event | None = None

    async def start(self) -> None:
        """Start the worker task. Must be called from an async context."""
        self._loop = asyncio.get_event_loop()
        self._event = asyncio.Event()
        asyncio.create_task(self._worker())
        # Wake worker if items were enqueued before start
        with self._lock:
            if self._priority or self._normal:
                self._event.set()
        log.info("triage_queue: worker started")

    def enqueue(self, email_id: str, priority: bool = False) -> bool:
        """
        Add email to the queue. Thread-safe; safe to call from background threads.
        Returns False if the email is already queued or currently processing (dedup).
        """
        with self._lock:
            if email_id in self._queued or email_id == self._processing:
                return False
            self._queued.add(email_id)
            if priority:
                self._priority.appendleft(email_id)
            else:
                self._normal.append(email_id)
        log.info("triage_queue: enqueued [%s] priority=%s", email_id[:8], priority)
        if self._loop and self._event:
            self._loop.call_soon_threadsafe(self._event.set)
        return True

    async def triage_now(self, email_id: str) -> dict | None:
        """
        Priority-enqueue and await the result. Used by the manual triage route.
        If the email is already queued or processing, just waits for that run.
        """
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        with self._lock:
            self._waiters.setdefault(email_id, []).append(fut)
            already_active = email_id in self._queued or email_id == self._processing
        if not already_active:
            self.enqueue(email_id, priority=True)
        return await fut

    def get_status(self) -> dict:
        with self._lock:
            return {
                "active": self._processing is not None or bool(self._priority or self._normal),
                "processing": self._processing,
                "queued": len(self._queued),
            }

    async def _worker(self) -> None:
        log.info("triage_queue: worker running")
        while True:
            if self._event:
                await self._event.wait()

            while True:
                with self._lock:
                    if self._priority:
                        email_id = self._priority.popleft()
                        self._queued.discard(email_id)
                    elif self._normal:
                        email_id = self._normal.popleft()
                        self._queued.discard(email_id)
                    else:
                        if self._event:
                            self._event.clear()
                        break
                    self._processing = email_id

                log.info("triage_queue: processing [%s]", email_id[:8])
                try:
                    result = await email_processor.auto_triage_email(email_id)
                except Exception as exc:
                    log.exception("triage_queue: error on [%s]: %s", email_id[:8], exc)
                    result = None

                with self._lock:
                    self._processing = None
                    waiters = self._waiters.pop(email_id, [])

                for fut in waiters:
                    if not fut.done():
                        fut.set_result(result)

                if self.STAGGER > 0:
                    await asyncio.sleep(self.STAGGER)


queue = TriageQueue()
