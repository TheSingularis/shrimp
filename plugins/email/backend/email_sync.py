"""
IMAP Sync Engine — full-featured multi-folder sync.

Two background threads:
  1. IDLE thread: server-push on INBOX for real-time new mail.
     Re-enters IDLE every 28 minutes (before the 30-min server timeout).
     On EXISTS/RECENT, exits IDLE and runs an incremental fetch + triage.

  2. Sync thread: every SYNC_INTERVAL_S seconds, syncs all active folders:
       - incremental_fetch: new UIDs above last known → new cache entries
       - expunge_check:     UIDs gone from server → remove from cache
       - flag_sync:         \\Seen/\\Flagged from server → update local cache

Replaces the old email_idle.py single-folder IDLE listener.
"""
from __future__ import annotations

import imaplib
import logging
import socket
import threading

import config
import email_client
import triage_queue as _triage_queue

log = logging.getLogger("shrimp.email_sync")

_IDLE_TIMEOUT_S  = 28 * 60   # re-enter IDLE before the 30-min server limit
_SYNC_INTERVAL_S = 5 * 60    # full folder sync every 5 minutes
_RECONNECT_BASE_S = 30
_RECONNECT_MAX_S  = 300

_stop_event = threading.Event()
_idle_thread: threading.Thread | None = None
_sync_thread: threading.Thread | None = None


# ── IDLE session (INBOX only) ──────────────────────────────────────────────────

def _idle_session() -> None:
    """
    Open a persistent IMAP connection to INBOX and hold it in IDLE.
    On EXISTS/RECENT push: exit IDLE, incremental-fetch, triage, re-enter IDLE.
    Raises RuntimeError("not supported") if the server lacks IDLE capability.
    Raises on connection/IO errors — the outer loop reconnects.
    """
    cfg = config.EMAIL_CONFIG
    inbox_mailbox = cfg.get("mailbox", "INBOX")

    conn = email_client._imap_connect()
    try:
        _, caps_data = conn.capability()
        caps = caps_data[0] if caps_data else b""
        if b"IDLE" not in caps.upper():
            raise RuntimeError("IDLE not supported by this IMAP server")

        conn.select(email_client._imap_name(inbox_mailbox))

        # Catch anything that arrived since the last run before entering IDLE
        with email_client._fetch_lock:
            new_emails = email_client.incremental_fetch(conn, inbox_mailbox, "INBOX", cfg)
        if cfg.get("auto_triage", True):
            for em in reversed(new_emails):
                _triage_queue.queue.enqueue(em["id"], front=True)

        log.info("IDLE: session active on %s/%s", cfg.get("imap_host"), inbox_mailbox)

        while not _stop_event.is_set():
            conn.send(b"IDLE001 IDLE\r\n")
            cont = conn.readline()
            if not cont.startswith(b"+"):
                log.warning("IDLE: unexpected continuation: %r", cont)
                break

            conn.sock.settimeout(_IDLE_TIMEOUT_S)
            new_mail = False
            flags_changed = False
            try:
                while not _stop_event.is_set():
                    line = conn.readline()
                    if b"EXISTS" in line or b"RECENT" in line:
                        new_mail = True
                        break
                    if b"FETCH" in line:
                        # Server push for flag changes (e.g. \Seen set by another client)
                        flags_changed = True
                        break
                    if line.startswith(b"IDLE001"):
                        break
            except (socket.timeout, TimeoutError):
                pass  # Normal timeout — re-enter IDLE

            conn.send(b"DONE\r\n")
            conn.sock.settimeout(10)
            try:
                conn.readline()  # consume tagged OK
            except (socket.timeout, TimeoutError):
                pass

            if new_mail and not _stop_event.is_set():
                conn.select(email_client._imap_name(inbox_mailbox))
                with email_client._fetch_lock:
                    new_emails = email_client.incremental_fetch(conn, inbox_mailbox, "INBOX", cfg)
                if new_emails and cfg.get("auto_triage", True):
                    for em in reversed(new_emails):
                        _triage_queue.queue.enqueue(em["id"], front=True)
            elif flags_changed and not _stop_event.is_set():
                email_client.flag_sync(conn, inbox_mailbox, "INBOX")

    finally:
        try:
            conn.logout()
        except Exception:
            pass


def _idle_loop() -> None:
    delay = _RECONNECT_BASE_S
    while not _stop_event.is_set():
        try:
            _idle_session()
            delay = _RECONNECT_BASE_S
        except RuntimeError as exc:
            if "not supported" in str(exc):
                log.info("IMAP IDLE not supported — relying on sync loop only")
                return
            log.warning("IDLE session ended (%s) — reconnecting in %ds", exc, delay)
        except Exception:
            log.exception("IDLE session error — reconnecting in %ds", delay)
        if not _stop_event.is_set():
            _stop_event.wait(delay)
            delay = min(delay * 2, _RECONNECT_MAX_S)


# ── Sync loop (all folders) ────────────────────────────────────────────────────

def _sync_once() -> None:
    """
    One full sync cycle: incremental fetch + expunge check + flag sync
    for every active folder (inbox, sent, archive, trash, junk).
    Uses a single IMAP connection for the whole cycle.
    """
    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled") or not cfg.get("imap_host"):
        return

    folders = email_client.list_imap_folders()
    active_roles = {"inbox", "sent", "archive", "trash", "junk"}
    folders_to_sync = [f for f in folders if f["role"] in active_roles]

    try:
        conn = email_client._imap_connect()
    except Exception:
        log.exception("Sync: IMAP connect failed")
        return

    try:
        for folder_info in folders_to_sync:
            if _stop_event.is_set():
                break
            imap_name    = folder_info["imap_name"]
            display_name = folder_info["display_name"]
            role         = folder_info["role"]
            mark_read    = role != "inbox"
            skip_triage  = role != "inbox"

            try:
                with email_client._fetch_lock:
                    new_emails = email_client.incremental_fetch(
                        conn, imap_name, display_name, cfg,
                        mark_read=mark_read, skip_triage=skip_triage,
                    )

                if new_emails:
                    if role == "inbox" and cfg.get("auto_triage", True):
                        for em in reversed(new_emails):
                            _triage_queue.queue.enqueue(em["id"], front=True)
                    log.info("Sync [%s]: %d new email(s)", display_name, len(new_emails))

                removed = email_client.expunge_check(conn, imap_name, display_name)
                if removed:
                    log.info("Sync [%s]: removed %d expunged email(s)", display_name, removed)

                email_client.flag_sync(conn, imap_name, display_name)

            except Exception:
                log.exception("Sync: error on folder %s", imap_name)
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def _sync_loop() -> None:
    """Periodic full sync of all folders every SYNC_INTERVAL_S seconds."""
    # Run an initial sync shortly after startup (let IDLE catch inbox first)
    _stop_event.wait(60)
    if _stop_event.is_set():
        return

    delay = _RECONNECT_BASE_S
    while not _stop_event.is_set():
        try:
            log.info("Sync: starting full folder sync")
            _sync_once()
            log.info("Sync: completed")
            delay = _RECONNECT_BASE_S
        except Exception:
            log.exception("Sync loop error — retrying in %ds", delay)
            _stop_event.wait(delay)
            delay = min(delay * 2, _RECONNECT_MAX_S)
            continue

        _stop_event.wait(_SYNC_INTERVAL_S)


# ── Public API ─────────────────────────────────────────────────────────────────

def sync_inbox_now() -> list[dict]:
    """
    Blocking INBOX incremental fetch — pulls any emails that arrived since the
    last sync and caches them locally.  Returns the list of newly-fetched emails.

    Called by email_triage before scanning for untriaged mail so that triage
    always operates on a current view of the inbox, not a stale cache.
    """
    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled") or not cfg.get("imap_host"):
        return []
    try:
        conn = email_client._imap_connect()
    except Exception:
        log.exception("sync_inbox_now: IMAP connect failed")
        return []
    try:
        inbox_mailbox = cfg.get("mailbox", "INBOX")
        conn.select(email_client._imap_name(inbox_mailbox))
        with email_client._fetch_lock:
            new_emails = email_client.incremental_fetch(conn, inbox_mailbox, "INBOX", cfg)
        if new_emails:
            log.info("sync_inbox_now: fetched %d new email(s)", len(new_emails))
        return new_emails
    except Exception:
        log.exception("sync_inbox_now: fetch failed")
        return []
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def start() -> None:
    """Start IDLE and periodic sync daemon threads. No-op if email is not configured."""
    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled") or not cfg.get("imap_host") or not cfg.get("username"):
        log.debug("Email not configured — sync engine not started")
        return

    global _idle_thread, _sync_thread
    _stop_event.clear()

    _idle_thread = threading.Thread(target=_idle_loop, daemon=True, name="imap-idle")
    _idle_thread.start()

    _sync_thread = threading.Thread(target=_sync_loop, daemon=True, name="imap-sync")
    _sync_thread.start()

    log.info("IMAP sync engine started (IDLE + 5-min folder sync)")


def stop() -> None:
    """Signal both background threads to exit cleanly."""
    _stop_event.set()
