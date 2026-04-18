"""
Email triage background job — 15-minute polling fallback.

Fetches any new emails not yet cached (deduplicated by message-id in
email_client) and triages each one immediately. This job is a safety net
for emails that the IMAP IDLE listener may have missed due to reconnects
or server gaps. When IDLE is running and healthy, this job typically finds
nothing to do.
"""
from __future__ import annotations

import logging

import config
import email_client
import email_processor
import notifications
import scheduler as _scheduler

log = logging.getLogger("shrimp.jobs.email_triage")


def _triage_one(email_id: str, from_: str, subject: str) -> None:
    try:
        result = _scheduler.run_async(
            email_processor.auto_triage_email(email_id), timeout=120
        )
        if result:
            log.info(
                "Triaged [%s]: %s — %s",
                result["urgency"],
                from_[:35],
                subject[:45],
            )
    except Exception:
        log.exception("Triage failed for email %s", email_id)


def run() -> None:
    """Fetch new emails, notify, and triage each one immediately."""
    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled"):
        log.debug("Email not enabled, skipping")
        return

    log.info("Email triage poll: fetching inbox...")
    new_emails = email_client.fetch_emails()

    if not new_emails:
        log.info("Email triage poll: no new emails")
        return

    log.info("Email triage poll: %d new email(s)", len(new_emails))
    email_processor._triage_begin(len(new_emails))
    try:
        for em in new_emails:
            notifications.append(
                title=f"New email: {em.get('subject', '(no subject)')}",
                body=f"From: {em.get('from', '')}",
                type="email_new",
                priority="normal",
                source="email_triage",
                actions=[{"label": "Open Email", "route": f"/email?id={em['id']}"}],
            )
            _triage_one(em["id"], em.get("from", "?"), em.get("subject", "?"))
            email_processor._triage_tick()
    finally:
        email_processor._triage_end()
