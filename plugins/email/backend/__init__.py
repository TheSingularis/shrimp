"""
Email plugin for SHRIMP.

Provides IMAP/SMTP email with AI triage, daily digest, and IDLE sync.
All routes are mounted under /plugins/email/ by the plugin loader.
"""
from __future__ import annotations

import asyncio
import inspect
import json
import logging
import re as _re
import threading
from pathlib import Path

import config as _config
from config_utils import atomic_write as _atomic_write
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

import email_client
import email_processor
import email_smtp
from plugin_base import ShrimpPlugin, PluginJob

log = logging.getLogger("shrimp.plugin.email")

# Path to core config.py — used by the config-write helpers below
_CONFIG_PATH = Path(inspect.getfile(_config))

# Digest file written by daily_digest job; read by GET /plugins/email/digest/latest
_DIGEST_FILE = Path(__file__).parent.parent.parent.parent / "notifications" / "digest_latest.json"

router = APIRouter(prefix="/plugins/email", tags=["email"])


# ── Pydantic models ───────────────────────────────────────────────────────────


class EmailConfigRequest(BaseModel):
    enabled: bool = False
    imap_host: str = ""
    imap_port: int = 993
    imap_ssl: bool = True
    username: str = ""
    password: str = ""
    mailbox: str = "INBOX"
    fetch_max: int = 50
    poll_interval_minutes: int = 15


class SmtpConfigRequest(BaseModel):
    enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_ssl: bool = False
    smtp_starttls: bool = True
    username: str = ""
    password: str = ""
    from_name: str = ""
    from_email: str = ""


class SendEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    cc: str = ""
    bcc: str = ""


class FlagRequest(BaseModel):
    flagged: bool


class ReadRequest(BaseModel):
    read: bool


class MoveEmailRequest(BaseModel):
    dest_folder: str


# ── Config write helpers ──────────────────────────────────────────────────────


def _write_email_config(cfg: dict) -> None:
    current = _CONFIG_PATH.read_text()
    new_block = f"EMAIL_CONFIG: dict = {repr(cfg)}"
    current = _re.sub(
        r"EMAIL_CONFIG: dict = \{.*?\}",
        new_block,
        current,
        flags=_re.DOTALL,
    )
    _atomic_write(_CONFIG_PATH, current)
    _config.EMAIL_CONFIG.update(cfg)
    log.info("EMAIL_CONFIG written")


def _write_smtp_config(cfg: dict) -> None:
    current = _CONFIG_PATH.read_text()
    new_block = f"SMTP_CONFIG: dict = {repr(cfg)}"
    current = _re.sub(
        r"SMTP_CONFIG: dict = \{.*?\}",
        new_block,
        current,
        flags=_re.DOTALL,
    )
    _atomic_write(_CONFIG_PATH, current)
    _config.SMTP_CONFIG.update(cfg)
    log.info("SMTP_CONFIG written")


# ── Routes: IMAP config ───────────────────────────────────────────────────────


@router.get("/config")
async def get_email_config():
    cfg = dict(_config.EMAIL_CONFIG)
    cfg["password"] = "••••••••" if cfg.get("password") else ""
    return cfg


@router.post("/config")
async def save_email_config(req: EmailConfigRequest):
    import scheduler
    cfg = dict(_config.EMAIL_CONFIG)
    cfg.update(req.model_dump())
    if req.password == "••••••••":
        cfg["password"] = _config.EMAIL_CONFIG.get("password", "")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _write_email_config, cfg)
    scheduler.set_automation_enabled("email_triage", cfg.get("enabled", False))
    return {"status": "ok"}


@router.post("/config/test")
async def test_email_config():
    loop = asyncio.get_event_loop()
    success, message = await loop.run_in_executor(None, email_client.test_connection)
    return {"success": success, "message": message}


# ── Routes: SMTP config ───────────────────────────────────────────────────────


@router.get("/smtp/config")
async def get_smtp_config():
    cfg = dict(_config.SMTP_CONFIG)
    cfg["password"] = "••••••••" if cfg.get("password") else ""
    return cfg


@router.post("/smtp/config")
async def save_smtp_config(req: SmtpConfigRequest):
    cfg = dict(_config.SMTP_CONFIG)
    data = req.model_dump()
    if data.get("password") == "••••••••":
        data["password"] = cfg.get("password", "")
    cfg.update(data)
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _write_smtp_config, cfg)
    return {"status": "ok"}


@router.post("/smtp/config/test")
async def test_smtp_config():
    loop = asyncio.get_event_loop()
    success, message = await loop.run_in_executor(None, email_smtp.test_connection)
    return {"success": success, "message": message}


# ── Routes: send ──────────────────────────────────────────────────────────────


@router.post("/send")
async def send_email(req: SendEmailRequest):
    loop = asyncio.get_event_loop()
    success, message = await loop.run_in_executor(
        None, email_smtp.send_email, req.to, req.subject, req.body, req.cc, req.bcc
    )
    if not success:
        raise HTTPException(status_code=500, detail=message)
    return {"status": "sent"}


# ── Routes: inbox / folders ───────────────────────────────────────────────────


@router.get("/inbox")
async def get_inbox(limit: int = 50, folder: str = "INBOX"):
    loop = asyncio.get_event_loop()
    emails = await loop.run_in_executor(None, email_client.list_emails_by_folder, folder, limit)
    return emails


@router.get("/search")
async def search_emails(q: str = "", limit: int = 50):
    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(None, email_client.search_emails, q, limit)
    return results


@router.post("/embed-all")
async def embed_all_emails():
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, email_client.embed_all_emails)
    return result


@router.get("/folders")
async def list_email_folders():
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, email_client.list_imap_folders)


@router.post("/fetch")
async def fetch_inbox():
    loop = asyncio.get_event_loop()
    new_emails = await loop.run_in_executor(None, email_client.fetch_emails)
    return {"fetched": len(new_emails), "folder": "INBOX"}


@router.post("/fetch/{folder}")
async def fetch_folder(folder: str, limit: int = 50):
    loop = asyncio.get_event_loop()
    count, msg = await loop.run_in_executor(None, email_client.fetch_folder, folder, limit)
    if msg == "IMAP error":
        raise HTTPException(status_code=500, detail=msg)
    return {"fetched": count, "folder": folder}


@router.post("/refresh-all")
async def refresh_all_emails():
    loop = asyncio.get_event_loop()
    emails = await loop.run_in_executor(None, email_client.list_emails, 500)
    count = 0
    for em in emails:
        if not em.get("html_body"):
            result = await loop.run_in_executor(None, email_client.refresh_email_body, em["id"])
            if result and result.get("html_body"):
                count += 1
    return {"refreshed": count}


# ── Routes: triage / sync state ───────────────────────────────────────────────


@router.get("/triage/status")
async def email_triage_status():
    return email_processor.get_triage_status()


@router.get("/sync-state")
async def email_sync_state():
    return email_client.get_sync_state()


# ── Routes: per-email actions ─────────────────────────────────────────────────


@router.post("/{email_id}/refresh-body")
async def refresh_email_body(email_id: str):
    loop = asyncio.get_event_loop()
    updated = await loop.run_in_executor(None, email_client.refresh_email_body, email_id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Email not found or IMAP not configured")
    return updated


@router.get("/flagged")
async def get_flagged_emails():
    loop = asyncio.get_event_loop()
    emails = await loop.run_in_executor(None, email_client.list_flagged)
    return emails


@router.post("/{email_id}/flag")
async def flag_email(email_id: str, req: FlagRequest):
    loop = asyncio.get_event_loop()
    ok, msg = await loop.run_in_executor(None, email_client.flag_email, email_id, req.flagged)
    if not ok:
        raise HTTPException(status_code=404, detail=msg)
    return {"status": "ok", "flagged": req.flagged, "message": msg}


@router.post("/{email_id}/read")
async def set_email_read_route(email_id: str, req: ReadRequest):
    loop = asyncio.get_event_loop()
    ok, msg = await loop.run_in_executor(None, email_client.set_email_read, email_id, req.read)
    if not ok:
        raise HTTPException(status_code=404, detail=msg)
    return {"status": "ok", "read": req.read, "message": msg}


@router.post("/{email_id}/move")
async def move_email_route(email_id: str, req: MoveEmailRequest):
    loop = asyncio.get_event_loop()
    ok, msg = await loop.run_in_executor(None, email_client.move_email, email_id, req.dest_folder)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"status": "ok", "folder": req.dest_folder, "message": msg}


@router.post("/{email_id}/archive")
async def archive_email_route(email_id: str):
    loop = asyncio.get_event_loop()
    ok, msg = await loop.run_in_executor(None, email_client.archive_email, email_id)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"status": "ok", "message": msg}


@router.post("/{email_id}/trash")
async def trash_email_route(email_id: str):
    loop = asyncio.get_event_loop()
    ok, msg = await loop.run_in_executor(None, email_client.trash_email, email_id)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"status": "ok", "message": msg}


@router.post("/{email_id}/junk")
async def junk_email_route(email_id: str):
    loop = asyncio.get_event_loop()
    ok, msg = await loop.run_in_executor(None, email_client.junk_email, email_id)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"status": "ok", "message": msg}


@router.get("/{email_id}/attachment/{filename}")
async def get_email_attachment(email_id: str, filename: str, dl: bool = False):
    attach_path = email_client._ATTACH_DIR / email_id / filename
    if not attach_path.exists():
        raise HTTPException(status_code=404, detail="Attachment not found")
    data = email_client.load_email(email_id)
    content_type = "application/octet-stream"
    if data:
        for a in data.get("attachments", []):
            if a.get("filename") == filename:
                content_type = a.get("content_type", content_type)
                break
    disposition = f'attachment; filename="{filename}"' if dl else f'inline; filename="{filename}"'
    return FileResponse(
        str(attach_path),
        media_type=content_type,
        headers={"Content-Disposition": disposition},
    )


@router.get("/{email_id}")
async def get_email(email_id: str):
    data = email_client.load_email(email_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Email not found")
    email_client.mark_email_read(email_id)
    return data


@router.post("/{email_id}/triage")
async def triage_email(email_id: str):
    data = email_client.load_email(email_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Email not found")

    async def _stream():
        async for token in email_processor.triage_email(email_id):
            yield token.encode()

    return StreamingResponse(_stream(), media_type="text/plain; charset=utf-8")


# ── Routes: digest ────────────────────────────────────────────────────────────


@router.get("/digest/latest")
async def get_latest_digest():
    if not _DIGEST_FILE.exists():
        return {"date": None, "summary": None, "emails": [], "unread_count": 0}
    try:
        return json.loads(_DIGEST_FILE.read_text())
    except Exception:
        return {"date": None, "summary": None, "emails": [], "unread_count": 0}


# ── Plugin class ──────────────────────────────────────────────────────────────


class EmailPlugin(ShrimpPlugin):
    id = "email"
    name = "Email"
    category = "core"

    def get_router(self):
        return router

    async def on_startup(self) -> None:
        import email_sync
        email_sync.start()
        threading.Thread(
            target=email_client.deduplicate_cache, daemon=True, name="email-dedup"
        ).start()
        threading.Thread(
            target=email_client.embed_all_emails, daemon=True, name="email-embed-backfill"
        ).start()

    async def on_shutdown(self) -> None:
        import email_sync
        email_sync.stop()

    def get_jobs(self) -> list[PluginJob]:
        from email_triage import run as triage_run
        from daily_digest import run as digest_run

        poll_mins = _config.EMAIL_CONFIG.get("poll_interval_minutes", 15)
        return [
            PluginJob(
                name="email_triage",
                fn=triage_run,
                cron=f"*/{poll_mins} * * * *",
                description="Polling fallback: fetch new emails and triage each one",
                enabled_default=_config.EMAIL_CONFIG.get("enabled", False),
            ),
            PluginJob(
                name="daily_digest",
                fn=digest_run,
                cron="0 8 * * *",
                description="Today's focus: action items from triaged emails",
                enabled_default=True,
            ),
        ]


plugin = EmailPlugin()
