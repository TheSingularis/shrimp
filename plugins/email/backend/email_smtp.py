"""SMTP email sending — stdlib smtplib, no extra dependencies."""
from __future__ import annotations

import imaplib
import logging
import re
import smtplib
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import config

log = logging.getLogger("shrimp.email_smtp")


def _make_server() -> smtplib.SMTP | smtplib.SMTP_SSL:
    cfg = config.SMTP_CONFIG
    host = cfg["smtp_host"]
    port = int(cfg.get("smtp_port", 587))
    if cfg.get("smtp_ssl", False):
        server: smtplib.SMTP | smtplib.SMTP_SSL = smtplib.SMTP_SSL(host, port, timeout=20)
    else:
        server = smtplib.SMTP(host, port, timeout=20)
        if cfg.get("smtp_starttls", True):
            server.starttls()
    server.login(cfg["username"], cfg["password"])
    return server


def send_email(
    to: str,
    subject: str,
    body: str,
    cc: str = "",
    bcc: str = "",
) -> tuple[bool, str]:
    """Send a plain-text email. Returns (success, message)."""
    cfg = config.SMTP_CONFIG
    if not cfg.get("enabled"):
        return False, "SMTP not enabled — configure it in Settings → Email"
    if not cfg.get("smtp_host") or not cfg.get("username"):
        return False, "SMTP host and username are required"

    try:
        from_email = cfg.get("from_email") or cfg["username"]
        from_name = cfg.get("from_name", "")
        from_header = f"{from_name} <{from_email}>" if from_name else from_email

        msg = MIMEMultipart("alternative")
        msg["From"] = from_header
        msg["To"] = to
        msg["Subject"] = subject
        if cc:
            msg["Cc"] = cc
        msg.attach(MIMEText(body, "plain"))

        recipients = [r.strip() for r in to.split(",") if r.strip()]
        if cc:
            recipients += [r.strip() for r in cc.split(",") if r.strip()]
        if bcc:
            recipients += [r.strip() for r in bcc.split(",") if r.strip()]

        raw = msg.as_bytes()

        server = _make_server()
        server.sendmail(from_email, recipients, raw)
        server.quit()
        log.info("Sent email to %s — %s", to, subject)

        _append_to_sent(raw)
        return True, "Sent"

    except Exception as exc:
        log.exception("SMTP send failed")
        return False, str(exc)


def _append_to_sent(raw_message: bytes) -> None:
    """IMAP APPEND the sent message to the Sent mailbox so it appears in Sent."""
    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled") or not cfg.get("imap_host"):
        return
    try:
        host = cfg["imap_host"]
        port = int(cfg.get("imap_port", 993))
        if cfg.get("imap_ssl", True):
            conn: imaplib.IMAP4 | imaplib.IMAP4_SSL = imaplib.IMAP4_SSL(host, port)
        else:
            conn = imaplib.IMAP4(host, port)
        conn.login(cfg["username"], cfg["password"])

        # Discover Sent mailbox name via LIST
        sent_mailbox = "Sent Messages"  # iCloud default
        _, folders_raw = conn.list()
        for item in folders_raw or []:
            line = item.decode() if isinstance(item, bytes) else item
            lower = line.lower()
            if r"\sent" in lower or "sent messages" in lower or ('"sent"' in lower and "sent messages" not in lower):
                m = re.search(r'"([^"]+)"\s*$', line)
                if m:
                    candidate = m.group(1)
                    # Prefer RFC 6154 \Sent flag
                    if r"\sent" in lower:
                        sent_mailbox = candidate
                        break
                    elif candidate.lower() in ("sent messages", "sent"):
                        sent_mailbox = candidate

        date_time = imaplib.Time2Internaldate(time.time())
        conn.append(sent_mailbox, r"\Seen", date_time, raw_message)
        conn.logout()
        log.info("Appended sent message to IMAP '%s'", sent_mailbox)
    except Exception:
        log.warning("Could not append sent message to IMAP Sent folder", exc_info=True)


def test_connection() -> tuple[bool, str]:
    """Test SMTP credentials. Returns (success, message)."""
    cfg = config.SMTP_CONFIG
    if not cfg.get("smtp_host") or not cfg.get("username"):
        return False, "smtp_host and username are required"
    try:
        server = _make_server()
        server.quit()
        host = cfg["smtp_host"]
        port = cfg.get("smtp_port", 587)
        return True, f"Connected to {host}:{port}"
    except Exception as exc:
        return False, str(exc)
