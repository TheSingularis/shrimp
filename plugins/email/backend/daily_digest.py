"""
Daily digest job — runs at 8am (and on demand from the dashboard).

Reads already-triaged email metadata from the local cache — no re-fetching
of email bodies. Collects action items grouped by urgency and asks the LLM
to produce a concise "Today's Focus" summary plus a concrete todo list.
Output is saved to notifications/digest_latest.json for the dashboard.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import httpx

import checklist
import config
import email_client
import notifications
import scheduler as _scheduler

log = logging.getLogger("shrimp.automations.daily_digest")

_DIGEST_FILE = Path(__file__).parent.parent.parent.parent / "notifications" / "digest_latest.json"
_URGENCY_ORDER = {"urgent": 0, "high": 1, "normal": 2, "low": 3, "spam": 4}


_DIGEST_PROMPT = """\
You are a personal assistant. Today is {date}.

The user has {count} unread email(s) that have been triaged. Based on the \
triage data below, create a focused daily action list.

{items_block}

---

Respond with exactly this format (no markdown fences):

**Today's Focus**: <1-2 sentence overview of what needs attention today>

**Action Items**:
<For each email that has actions, one line per action:>
- [ ] <action> — {from_label}: <sender> re: <subject>

If an email has no action items, skip it entirely.
If there are no action items at all, write "- [ ] No actions needed — inbox clear."

Sort by urgency: urgent first, then high, normal, low. Skip spam entirely.
Be direct and concise. Do not add commentary outside this format."""


def _build_items_block(emails: list[dict]) -> str:
    """Build a compact summary block from already-triaged email metadata."""
    lines: list[str] = []
    for em in emails:
        urgency = em.get("triage_priority") or "normal"
        if urgency == "spam":
            continue
        note = em.get("triage_note") or "(no summary)"
        actions = em.get("triage_actions") or []
        action_str = "; ".join(actions) if actions else "none"
        lines.append(
            f"[{urgency}] From: {em.get('from', '?')} | Subject: {em.get('subject', '?')}\n"
            f"  Summary: {note}\n"
            f"  Actions: {action_str}"
        )
    return "\n\n".join(lines) if lines else "(no triaged emails)"


async def _call_llm(prompt: str) -> str:
    parts: list[str] = []
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{config.OLLAMA_HOST}/api/generate",
            json={
                "model": config.OLLAMA_MODEL,
                "prompt": prompt,
                "stream": True,
                "options": {"num_ctx": min(config.NUM_CTX, 4096)},
            },
        ) as resp:
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                    parts.append(obj.get("response", ""))
                    if obj.get("done"):
                        break
                except json.JSONDecodeError:
                    pass
    return "".join(parts).strip()


def _parse_digest(raw: str) -> tuple[str, list[str]]:
    """Extract focus summary and action item lines from LLM output."""
    focus = ""
    actions: list[str] = []
    for line in raw.splitlines():
        stripped = line.strip()
        if stripped.lower().startswith("**today's focus**"):
            focus = stripped.split("**:", 1)[-1].strip().lstrip("*").strip()
            if not focus:
                # Summary may be on same line after colon
                parts = stripped.split(":", 1)
                focus = parts[1].strip() if len(parts) > 1 else ""
        elif stripped.startswith("- [ ]") or stripped.startswith("- [x]"):
            actions.append(stripped)
    return focus, actions


def _parse_action_item(action_text: str, emails: list[dict]) -> dict:
    """
    Parse action item format and match to source email.
    Format: "- [ ] <action> — from: <sender> re: <subject>"
    Returns dict with text, from, subject, email_id, priority.
    """
    import re

    result: dict = {"text": action_text, "priority": "normal"}

    # Remove checkbox prefix
    text = action_text
    if text.startswith("- [ ] "):
        text = text[6:]
    elif text.startswith("- [x] "):
        text = text[6:]

    # Try to extract "from: X re: Y" pattern
    # Pattern: "action text — from: sender re: subject" or similar
    match = re.search(r"[—–-]\s*(?:from:?\s*)(.+?)\s+re:\s*(.+)$", text, re.IGNORECASE)
    if match:
        sender_hint = match.group(1).strip()
        subject_hint = match.group(2).strip()
        # Extract just the action part (before the dash)
        action_part = re.sub(r"\s*[—–-]\s*(?:from:?\s*).+$", "", text, flags=re.IGNORECASE)
        result["text"] = action_part.strip() if action_part.strip() else text
        result["from"] = sender_hint
        result["subject"] = subject_hint

        # Try to find matching email for dedup and linking
        for email in emails:
            email_from = email.get("from", "")
            email_subject = email.get("subject", "")
            # Fuzzy match: check if hints appear in email fields
            if (sender_hint.lower() in email_from.lower() or
                email_from.lower() in sender_hint.lower()):
                if (subject_hint.lower() in email_subject.lower() or
                    email_subject.lower() in subject_hint.lower()):
                    result["email_id"] = email.get("id")
                    result["from"] = email_from
                    result["subject"] = email_subject
                    result["priority"] = email.get("triage_priority", "normal")
                    break

    return result


def run() -> None:
    """Entry point called by the scheduler (sync)."""
    try:
        log.info("Daily digest starting")

        all_emails = email_client.list_emails(limit=200)
        # Only unread, non-spam emails that have been triaged
        relevant = [
            e for e in all_emails
            if not e.get("read") and e.get("triage_priority") != "spam"
        ]
        # Sort by urgency
        relevant.sort(key=lambda e: _URGENCY_ORDER.get(e.get("triage_priority") or "normal", 2))

        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        display_date = datetime.now().strftime("%A, %B %-d, %Y")

        if relevant:
            items_block = _build_items_block(relevant)
            prompt = _DIGEST_PROMPT.format(
                date=display_date,
                count=len(relevant),
                items_block=items_block,
                from_label="from",
            )
            raw = _scheduler.run_async(_call_llm(prompt))
            log.info("Daily digest: LLM output (%d chars): %.300s", len(raw), raw)

            focus, action_items = _parse_digest(raw)
            summary_text = focus or f"{len(relevant)} email(s) need attention."
        else:
            summary_text = "No unread emails with actions. Inbox clear."
            action_items = []

        # Add action items to the persistent checklist
        added_count = 0
        for action_text in action_items:
            # Parse action item format: "- [ ] <action> — from: <sender> re: <subject>"
            parsed = _parse_action_item(action_text, relevant)
            checklist.append_item(
                text=parsed["text"],
                source="email_digest",
                source_ref=parsed.get("email_id"),
                priority=parsed.get("priority", "normal"),
                context={
                    "from": parsed.get("from"),
                    "subject": parsed.get("subject"),
                    "email_id": parsed.get("email_id"),
                },
            )
            added_count += 1
        log.info("Daily digest: added %d items to checklist", added_count)

        # Save digest summary (action_items no longer needed here)
        digest_data = {
            "date": date_str,
            "display_date": display_date,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "unread_count": len(relevant),
            "summary": summary_text,
        }

        _DIGEST_FILE.parent.mkdir(parents=True, exist_ok=True)
        _DIGEST_FILE.write_text(json.dumps(digest_data, indent=2))
        log.info("Daily digest: saved summary")

        notifications.append(
            title="Today's Focus",
            body=summary_text[:300],
            type="digest_ready",
            priority="normal",
            source="daily_digest",
            actions=[{"label": "View on Dashboard", "route": "/dashboard"}],
        )

        log.info("Daily digest complete")
    except Exception:
        log.exception("Daily digest job failed")
