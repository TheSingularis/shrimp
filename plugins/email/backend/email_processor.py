"""
LLM-driven email triage.
Classifies urgency, extracts action items, and produces a readable report.
All triage calls go through auto_triage_email(); the queue in triage_queue.py
handles serialization and manual/background dispatch.
"""
from __future__ import annotations

import json
import logging
import re

import httpx
import config
import email_client
import notifications

log = logging.getLogger("shrimp.email_processor")


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
    log.info("check_ollama: checking %s for model '%s'", config.OLLAMA_HOST, config.OLLAMA_MODEL)
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
    log.info("check_ollama: available models: %s", available)
    model = config.OLLAMA_MODEL
    base = model.split(":")[0]
    if not any(m == model or m.split(":")[0] == base for m in available):
        hint = f"ollama pull {model}"
        raise RuntimeError(
            f"Ollama model '{model}' not found. "
            f"Available: {', '.join(available) or 'none'}. "
            f"Run: {hint}"
        )
    log.info("check_ollama: OK (model '%s' available)", model)


async def _llm_generate(prompt: str, timeout: int = 120) -> str:
    """Non-streaming LLM call, returns full response string."""
    log.info("_llm_generate: POST %s/api/generate model=%s prompt=%d chars timeout=%ds",
             config.OLLAMA_HOST, config.OLLAMA_MODEL, len(prompt), timeout)
    parts: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                f"{config.OLLAMA_HOST}/api/generate",
                json={
                    "model": config.OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": True,
                    "options": {"num_ctx": config.NUM_CTX},
                },
            ) as resp:
                log.info("_llm_generate: HTTP %s", resp.status_code)
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        obj = json.loads(line)
                        if obj.get("error"):
                            log.error("_llm_generate: Ollama returned error: %s", obj["error"])
                            raise RuntimeError(f"Ollama error: {obj['error']}")
                        parts.append(obj.get("response", ""))
                        if obj.get("done"):
                            log.info("_llm_generate: done — %d chars collected", sum(len(p) for p in parts))
                            break
                    except json.JSONDecodeError as e:
                        log.warning("_llm_generate: JSON decode error on line %r: %s", line[:80], e)
    except httpx.TimeoutException:
        log.error("_llm_generate: timed out after %ds (model=%s)", timeout, config.OLLAMA_MODEL)
        raise
    except httpx.HTTPStatusError as e:
        log.error("_llm_generate: HTTP error %s from Ollama: %s", e.response.status_code, e)
        raise
    except Exception:
        log.exception("_llm_generate: unexpected error")
        raise
    result = "".join(parts).strip()
    if not result:
        log.warning("_llm_generate: assembled empty string from %d parts", len(parts))
    return result


# ── Public API ─────────────────────────────────────────────────────────────────

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

    subj = (data.get("subject") or "")[:50]
    from_ = (data.get("from") or "")[:40]
    log.info("auto_triage: [%s] '%s' from '%s' — prompt %d chars", email_id[:8], subj, from_, len(prompt))
    try:
        raw = await _llm_generate(prompt, timeout=120)
    except Exception as exc:
        log.error("auto_triage: LLM call failed for %s: %s", email_id, exc)
        return None
    if not raw:
        log.warning("auto_triage: empty LLM response for [%s] '%s'", email_id[:8], subj)
        return None

    urgency, note, actions = _parse_triage_markdown(raw)
    log.info("auto_triage: [%s] urgency=%s note=%r", email_id[:8], urgency, note[:60] if note else "")

    data["triaged"] = True
    data["triage_result"] = raw.strip()
    data["triage_priority"] = urgency
    data["triage_note"] = note
    data["triage_actions"] = actions
    try:
        email_client._save_email(data)
        log.info("auto_triage: saved [%s]", email_id[:8])
    except Exception:
        log.exception("auto_triage: FAILED to save email [%s]", email_id[:8])
        return None
    email_client.embed_email(data["id"])

    return {"urgency": urgency, "note": note}
