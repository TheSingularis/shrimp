"""
Email triage scheduled job — 15-minute polling safety net.

Scans for untriaged emails and enqueues them. Deduplication in triage_queue
means this is a no-op when IDLE + startup backfill are keeping up.
Guards against missed IDLE pushes and edge cases during app restarts.
"""
from __future__ import annotations

import logging

import config
import email_client
import email_processor
import email_sync
import notifications
import triage_queue

log = logging.getLogger("shrimp.automations.email_triage")


def run() -> None:
    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled"):
        log.debug("Email not enabled, skipping")
        return
    if not cfg.get("auto_triage", True):
        log.debug("auto_triage disabled, skipping")
        return

    try:
        email_processor.check_ollama()
    except RuntimeError as e:
        msg = str(e)
        log.error("Email triage aborted: %s", msg)
        notifications.append(
            title="Email triage: Ollama not configured",
            body=msg,
            type="error",
            priority="high",
            source="email_triage",
        )
        return

    email_sync.sync_inbox_now()

    backlog = email_client.list_untriaged_emails()
    n = sum(1 for em in backlog if triage_queue.queue.enqueue(em["id"]))
    if n:
        log.info("email_triage: enqueued %d untriaged email(s)", n)
    else:
        log.info("email_triage: nothing new to enqueue")
