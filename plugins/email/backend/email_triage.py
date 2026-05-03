"""
Email triage background job — 15-minute polling fallback.

Fetches new emails from IMAP and also picks up any cached emails that were
never triaged (e.g. fetched before triage was running). Triages each one
immediately and reports per-email progress to the scheduler.
"""
from __future__ import annotations

import logging

import config
import email_client
import email_processor
import notifications
import scheduler as _scheduler

log = logging.getLogger("shrimp.automations.email_triage")

_JOB_NAME = "email_triage"


def _triage_one(email_id: str, from_: str, subject: str) -> None:
    try:
        result = _scheduler.run_async(
            email_processor.auto_triage_email(email_id), timeout=120
        )
        if result:
            log.info(
                "  -> done [%s]: %s — %s",
                result["urgency"],
                from_[:35],
                subject[:45],
            )
        else:
            log.warning("  -> no result for %s (empty LLM response?)", email_id)
    except Exception as exc:
        log.exception("  -> FAILED for %s: %s", email_id, exc)


def run() -> None:
    """Fetch new emails, triage backlog, notify, and report progress."""
    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled"):
        log.debug("Email not enabled, skipping")
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
        raise

    log.info("Email triage poll: fetching inbox...")
    new_emails = email_client.fetch_emails()
    new_ids = {e["id"] for e in new_emails}

    backlog = [e for e in email_client.list_untriaged_emails() if e["id"] not in new_ids]
    to_triage = backlog + new_emails  # oldest first, then newest

    if not to_triage:
        log.info("Email triage poll: nothing to triage")
        return

    log.info(
        "Email triage poll: %d to triage (%d new, %d backlog)",
        len(to_triage), len(new_emails), len(backlog),
    )

    email_processor._triage_begin(len(to_triage))
    try:
        for i, em in enumerate(to_triage):
            subj = em.get("subject") or "(no subject)"
            from_ = em.get("from", "?")
            log.info("[%d/%d] Triaging: %s — %s", i + 1, len(to_triage), from_[:40], subj[:50])
            _scheduler.set_automation_progress(_JOB_NAME, {
                "done": i,
                "total": len(to_triage),
                "current": subj,
            })

            if em["id"] in new_ids:
                notifications.append(
                    title=f"New email: {subj}",
                    body=f"From: {from_}",
                    type="email_new",
                    priority="normal",
                    source="email_triage",
                    actions=[{"label": "Open Email", "route": f"/email?id={em['id']}"}],
                )

            _triage_one(em["id"], from_, subj)
            email_processor._triage_tick()
    finally:
        email_processor._triage_end()
        _scheduler.set_automation_progress(_JOB_NAME, {
            "done": len(to_triage),
            "total": len(to_triage),
            "current": None,
        })
        log.info("Triage complete: %d email(s) processed", len(to_triage))
