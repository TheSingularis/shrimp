"""SMTP email sending — stdlib smtplib, no extra dependencies."""
from __future__ import annotations

import logging
import smtplib
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

        server = _make_server()
        server.sendmail(from_email, recipients, msg.as_string())
        server.quit()
        log.info("Sent email to %s — %s", to, subject)
        return True, "Sent"

    except Exception as exc:
        log.exception("SMTP send failed")
        return False, str(exc)


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
