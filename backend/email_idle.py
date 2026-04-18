"""
IMAP IDLE listener — receives new mail in real time via server push.

Opens a persistent IMAP connection and issues the IDLE command (RFC 2177).
When the server sends an EXISTS notification, we exit IDLE, call fetch_emails()
to cache the new message(s), then triage each one immediately.
The connection is re-entered into IDLE every 28 minutes (before the 30-min
server timeout). On any error we reconnect with exponential backoff.

Falls back gracefully (logs + returns) if the server does not advertise IDLE
in its CAPABILITY response — the 15-minute polling job takes over.
"""
from __future__ import annotations

import imaplib
import logging
import socket
import threading

import config
import email_client
import email_processor
import scheduler as _scheduler

log = logging.getLogger("shrimp.email_idle")

_IDLE_TIMEOUT_S = 28 * 60   # re-enter IDLE before the 30-min server limit
_RECONNECT_BASE_S = 30      # initial reconnect delay
_RECONNECT_MAX_S = 300      # cap at 5 minutes

_stop_event = threading.Event()
_idle_thread: threading.Thread | None = None


# ── Internal helpers ───────────────────────────────────────────────────────────

def _triage_one(email_id: str) -> None:
    """Triage a single email via the main event loop. Logs errors, never raises."""
    try:
        result = _scheduler.run_async(
            email_processor.auto_triage_email(email_id), timeout=120
        )
        if result:
            log.info("IDLE triaged [%s]: %s", result["urgency"], email_id)
    except Exception:
        log.exception("IDLE triage failed for %s", email_id)


def _idle_session() -> None:
    """
    Run one IDLE session on a fresh IMAP connection.
    Raises RuntimeError("not supported") if the server lacks IDLE capability.
    Raises on connection/IO errors — caller reconnects.
    """
    cfg = config.EMAIL_CONFIG
    mailbox = cfg.get("mailbox", "INBOX")

    conn = email_client._imap_connect()
    try:
        # Check IDLE capability before doing anything else
        _, caps_data = conn.capability()
        caps = caps_data[0] if caps_data else b""
        if b"IDLE" not in caps.upper():
            raise RuntimeError("IDLE not supported by this IMAP server")

        conn.select(mailbox)

        # Initial sync — catch anything that arrived since last run
        new_emails = email_client.fetch_emails()
        if new_emails:
            email_processor._triage_begin(len(new_emails))
            try:
                for em in new_emails:
                    _triage_one(em["id"])
                    email_processor._triage_tick()
            finally:
                email_processor._triage_end()

        log.info("IDLE: session active on %s/%s", cfg.get("imap_host"), mailbox)

        while not _stop_event.is_set():
            # Enter IDLE
            conn.send(b"IDLE001 IDLE\r\n")
            cont = conn.readline()
            if not cont.startswith(b"+"):
                log.warning("IDLE: unexpected continuation response: %r", cont)
                break

            # Wait for server push or timeout
            conn.sock.settimeout(_IDLE_TIMEOUT_S)
            new_mail = False
            try:
                while not _stop_event.is_set():
                    line = conn.readline()
                    if b"EXISTS" in line or b"RECENT" in line:
                        new_mail = True
                        break
                    # Server terminated IDLE (e.g. BYE or tagged OK)
                    if line.startswith(b"IDLE001"):
                        break
            except (socket.timeout, TimeoutError):
                pass  # Normal — re-enter IDLE

            # Exit IDLE
            conn.send(b"DONE\r\n")
            conn.sock.settimeout(10)
            try:
                conn.readline()  # consume tagged OK
            except (socket.timeout, TimeoutError):
                pass

            if new_mail and not _stop_event.is_set():
                new_emails = email_client.fetch_emails()
                if new_emails:
                    email_processor._triage_begin(len(new_emails))
                    try:
                        for em in new_emails:
                            _triage_one(em["id"])
                            email_processor._triage_tick()
                    finally:
                        email_processor._triage_end()

    finally:
        try:
            conn.logout()
        except Exception:
            pass


def _idle_loop() -> None:
    """Outer reconnect loop with exponential backoff."""
    delay = _RECONNECT_BASE_S

    while not _stop_event.is_set():
        try:
            _idle_session()
            delay = _RECONNECT_BASE_S  # clean exit — reset backoff
        except RuntimeError as exc:
            if "not supported" in str(exc):
                log.info("IMAP IDLE not supported — relying on 15-min polling only")
                return  # permanent exit, no retry
            log.warning("IDLE session ended (%s) — reconnecting in %ds", exc, delay)
        except Exception:
            log.exception("IDLE session error — reconnecting in %ds", delay)

        if not _stop_event.is_set():
            _stop_event.wait(delay)
            delay = min(delay * 2, _RECONNECT_MAX_S)


# ── Public API ─────────────────────────────────────────────────────────────────

def start() -> None:
    """Start the IDLE listener daemon thread. No-op if email is not configured."""
    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled") or not cfg.get("imap_host") or not cfg.get("username"):
        log.debug("Email not configured — IDLE listener not started")
        return

    global _idle_thread
    _stop_event.clear()
    _idle_thread = threading.Thread(
        target=_idle_loop, daemon=True, name="imap-idle"
    )
    _idle_thread.start()
    log.info("IMAP IDLE listener started")


def stop() -> None:
    """Signal the IDLE thread to exit cleanly."""
    _stop_event.set()
