"""
LLM-driven email triage.
Classifies urgency, extracts action items, and streams a readable report.
Both interactive and background triage use the same prompt and parse logic.
"""
from __future__ import annotations

import json
import logging
import re
from typing import AsyncIterator

import httpx
import config
import email_client
import notifications

log = logging.getLogger("shrimp.email_processor")

# ── Triage progress state ───────────────────────────────────────────────────────
import threading as _threading

_triage_lock = _threading.Lock()
_triage_state: dict = {"active": False, "done": 0, "total": 0}


def get_triage_status() -> dict:
    with _triage_lock:
        return dict(_triage_state)


def _triage_begin(total: int) -> None:
    with _triage_lock:
        _triage_state.update({"active": True, "done": 0, "total": total})


def _triage_tick() -> None:
    with _triage_lock:
        _triage_state["done"] += 1


def _triage_end() -> None:
    with _triage_lock:
        _triage_state.update({"active": False, "done": 0, "total": 0})


# ── Prompt ─────────────────────────────────────────────────────────────────────

_TRIAGE_PROMPT = """You are an intelligent email assistant. Analyze the email below and provide a concise triage report.

## Email
Folder: {folder}
From: {from_}
Subject: {subject}
Date: {date}
{attachments}
{body}

---

If the Folder is Sent, Drafts, or a sent-mail folder: this email was WRITTEN BY the user, not received. Summarize what was sent and any follow-up the user may want. Do not suggest a reply. Action items should be things the user might need to follow up on (e.g. await a response, confirm delivery). Urgency reflects how important the sent message was.

Please provide:
1. **Urgency**: urgent / high / normal / low / spam
2. **Summary**: 1-2 sentence summary of the email
3. **Action items**: Bullet list of things to follow up on (if any). Write "None" if nothing needed.
4. **Suggested reply**: Omit for sent mail. For received mail, include a 1-2 sentence reply if a response seems needed.

Urgency guide:
- urgent: Security alerts, fraud, job interview/offer, time-critical emergencies
- high: Bank transactions (deposits/withdrawals/bills), direct personal emails, job application updates
- normal: Receipts for purchases you made, account statements, service notifications worth noting
- low: Subscription renewals, shipping updates, automated but occasionally useful
- spam: Newsletters, marketing, promotions, social media digests, anything mass-mailed

Be concise and direct."""


# ── Helpers ────────────────────────────────────────────────────────────────────

def _attachment_context(data: dict) -> str:
    """Build a one-line attachment summary for the triage prompt."""
    attachments = data.get("attachments") or []
    if not attachments:
        return ""
    parts = []
    for a in attachments:
        size = a.get("size", 0)
        size_str = f"{size / 1024:.0f} KB" if size < 1_048_576 else f"{size / 1_048_576:.1f} MB"
        parts.append(f"{a.get('filename', '?')} ({a.get('content_type', 'unknown')}, {size_str})")
    return f"Attachments ({len(attachments)}): {', '.join(parts)}\n"


def _parse_triage_markdown(text: str) -> tuple[str, str, list[str]]:
    """
    Parse a triage markdown report into (urgency, note, actions).
    Shared by both interactive and background triage paths.
    """
    urgency = "normal"
    note = ""
    actions: list[str] = []
    in_actions = False

    for line in text.splitlines():
        line_l = line.lower()
        stripped = line.strip()
        if re.search(r"\*\*urgency\*\*", line, re.IGNORECASE):
            in_actions = False
            if "urgent" in line_l:
                urgency = "urgent"
            elif "high" in line_l:
                urgency = "high"
            elif "spam" in line_l:
                urgency = "spam"
            elif "low" in line_l:
                urgency = "low"
        elif re.search(r"\*\*summary\*\*", line, re.IGNORECASE):
            in_actions = False
            m = re.search(r"\*\*summary\*\*[:\s]+(.+)", line, re.IGNORECASE)
            if m and not note:
                note = m.group(1).strip()
        elif re.search(r"\*\*action items?\*\*", line, re.IGNORECASE):
            in_actions = True
        elif re.search(r"\*\*suggested reply\*\*", line, re.IGNORECASE):
            in_actions = False
        elif in_actions and re.match(r"^[-*•]", stripped):
            action = stripped.lstrip("-*•").strip()
            if action and action.lower() != "none":
                actions.append(action)

    return urgency, note, actions


def check_ollama() -> None:
    """Raise RuntimeError with a user-readable message if Ollama is unreachable or model is missing."""
    try:
        r = httpx.get(f"{config.OLLAMA_HOST}/api/tags", timeout=5.0)
        r.raise_for_status()
    except httpx.ConnectError:
        raise RuntimeError(
            f"Ollama is not running at {config.OLLAMA_HOST}. "
            "Start Ollama and try again."
        )
    except Exception as e:
        raise RuntimeError(f"Ollama health check failed: {e}")

    available = [m["name"] for m in r.json().get("models", [])]
    model = config.OLLAMA_MODEL
    base = model.split(":")[0]
    if not any(m == model or m.split(":")[0] == base for m in available):
        hint = f"ollama pull {model}"
        raise RuntimeError(
            f"Ollama model '{model}' not found. "
            f"Available: {', '.join(available) or 'none'}. "
            f"Run: {hint}"
        )


async def _llm_generate(prompt: str, timeout: int = 120) -> str:
    """Non-streaming LLM call, returns full response string."""
    parts: list[str] = []
    async with httpx.AsyncClient(timeout=timeout) as client:
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
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                    if obj.get("error"):
                        raise RuntimeError(f"Ollama error: {obj['error']}")
                    parts.append(obj.get("response", ""))
                    if obj.get("done"):
                        break
                except json.JSONDecodeError:
                    pass
    return "".join(parts).strip()


# ── Public API ─────────────────────────────────────────────────────────────────

async def triage_email(email_id: str) -> AsyncIterator[str]:
    """
    Stream a readable triage report for an email (used by the UI).
    Also saves triage_priority, triage_note, and triage_actions as structured fields.
    """
    data = email_client.load_email(email_id)
    if data is None:
        yield "Error: Email not found."
        return

    try:
        check_ollama()
    except RuntimeError as e:
        yield f"Error: {e}"
        return

    prompt = _TRIAGE_PROMPT.format(
        folder=data.get("folder", "Inbox"),
        from_=data.get("from", ""),
        subject=data.get("subject", ""),
        date=data.get("date", ""),
        attachments=_attachment_context(data),
        body=data.get("body", "")[:8000],
    )

    full_response = ""
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{config.OLLAMA_HOST}/api/generate",
                json={
                    "model": config.OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": True,
                    "options": {"num_ctx": min(config.NUM_CTX, 8192)},
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                        token = chunk.get("response", "")
                        if token:
                            full_response += token
                            yield token
                        if chunk.get("done"):
                            break
                    except json.JSONDecodeError:
                        pass

    except Exception as e:
        log.exception("Triage LLM call failed for %s", email_id)
        yield f"\n\nError during triage: {e}"
        return

    urgency, note, actions = _parse_triage_markdown(full_response)

    data["triaged"] = True
    data["triage_result"] = full_response.strip()
    data["triage_priority"] = urgency
    data["triage_note"] = note
    data["triage_actions"] = actions
    email_client._save_email(data)
    # Refresh embedding now that triage_note/actions are available
    email_client.embed_email(data["id"])

    notif_priority = "high" if urgency == "urgent" else ("low" if urgency in ("low", "spam") else "normal")
    notifications.append(
        title=f"Email triaged: {data.get('subject', '(no subject)')}",
        body=f"From: {data.get('from', '')} — Urgency: {urgency}",
        type="email_triage",
        priority=notif_priority,
        source="email_triage",
        actions=[{"label": "Open Email", "route": f"/email?id={email_id}"}],
    )


async def auto_triage_email(email_id: str) -> dict | None:
    """
    Background auto-triage: same prompt and parsing as interactive triage,
    but non-streaming. Does NOT post a notification (bulk operation).
    Returns {"urgency": ..., "note": ...} or None on failure.
    """
    data = email_client.load_email(email_id)
    if data is None:
        return None

    prompt = _TRIAGE_PROMPT.format(
        folder=data.get("folder", "Inbox"),
        from_=data.get("from", ""),
        subject=data.get("subject", ""),
        date=data.get("date", ""),
        attachments=_attachment_context(data),
        body=(data.get("body", "") or "")[:8000],
    )

    log.debug("auto_triage: calling LLM for %s (prompt ~%d chars)", email_id, len(prompt))
    raw = await _llm_generate(prompt, timeout=120)
    if not raw:
        log.warning("auto_triage: empty LLM response for %s (prompt was %d chars)", email_id, len(prompt))
        return None
    log.debug("auto_triage: got %d chars from LLM for %s", len(raw), email_id)

    urgency, note, actions = _parse_triage_markdown(raw)

    data["triaged"] = True
    data["triage_result"] = raw.strip()
    data["triage_priority"] = urgency
    data["triage_note"] = note
    data["triage_actions"] = actions
    email_client._save_email(data)
    email_client.embed_email(data["id"])

    return {"urgency": urgency, "note": note}
