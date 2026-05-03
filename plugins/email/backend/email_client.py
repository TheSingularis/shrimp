"""
Email client — IMAP fetch with local JSON cache.
Uses stdlib imaplib (run in thread executor) so no extra dependencies needed.
HTML bodies are stripped to plain text via stdlib html.parser.
"""
from __future__ import annotations

import email as email_lib
import email.header
import imaplib
import json
import logging
import math
import re
import threading
import uuid
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape as html_unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import httpx
import config
from config_utils import get_data_dir

log = logging.getLogger("shrimp.email_client")

_CACHE_DIR = get_data_dir() / "emails"
_CACHE_DIR.mkdir(exist_ok=True)
_ATTACH_DIR = _CACHE_DIR / "attachments"
_ATTACH_DIR.mkdir(exist_ok=True)

# Serialize all fetch_emails() calls so concurrent callers (IDLE thread,
# triage scheduler, manual fetch) cannot both write the same email before
# either has updated the dedup set.
_fetch_lock = threading.Lock()


# ── HTML → plain text ─────────────────────────────────────────────────────────

class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._skip_tags = {"script", "style", "head"}
        self._skipping = False

    def handle_starttag(self, tag, attrs):
        if tag.lower() in self._skip_tags:
            self._skipping = True
        if tag.lower() in ("br", "p", "div", "tr", "li"):
            self._parts.append("\n")

    def handle_endtag(self, tag):
        if tag.lower() in self._skip_tags:
            self._skipping = False

    def handle_data(self, data):
        if not self._skipping:
            self._parts.append(data)

    def get_text(self) -> str:
        text = html_unescape("".join(self._parts))
        # Strip zero-width characters (common in HTML email preheaders)
        text = re.sub(r"[\u200b\u200c\u200d\ufeff\u00ad]", "", text)
        # Collapse runs of whitespace on a line, then blank lines
        text = re.sub(r"[ \t]{2,}", " ", text)
        return re.sub(r"\n{3,}", "\n\n", text).strip()


def _strip_html(html: str) -> str:
    s = _HTMLStripper()
    try:
        s.feed(html)
        return s.get_text()
    except Exception:
        return re.sub(r"<[^>]+>", "", html).strip()


# ── Header decoding ───────────────────────────────────────────────────────────

def _decode_header(value: str | None) -> str:
    if not value:
        return ""
    parts = email.header.decode_header(value)
    decoded = []
    for part, enc in parts:
        if isinstance(part, bytes):
            decoded.append(part.decode(enc or "utf-8", errors="replace"))
        else:
            decoded.append(str(part))
    return " ".join(decoded)


# ── Body extraction ───────────────────────────────────────────────────────────

def _looks_like_html(text: str) -> bool:
    """Return True if the text appears to be HTML rather than plain text.

    Used only for non-multipart messages whose MIME type is ambiguous.
    Requires strong structural indicators to avoid false positives on
    plain text that happens to contain angle brackets (RTF, code, URLs).
    """
    sample = text[:2000].lower().lstrip()
    if sample.startswith("<!doctype html") or re.match(r"<html[\s>]", sample):
        return True
    # Require at least 2 distinct HTML structural tags
    tags = ["<body", "<div>", "<div ", "<p>", "<p ", "<table", "<td", "<tr",
            "<span>", "<span ", "<br>", "<br/", "<a ", "<img "]
    return sum(1 for t in tags if t in sample) >= 2


def _extract_body(msg: email_lib.message.Message) -> tuple[str, str, bool]:
    """Return (plain_text, html_body, has_genuine_plain). Both strings may be empty.

    has_genuine_plain is True only when a real text/plain MIME part was found —
    not when plain_text was derived by stripping HTML.

    Inline images (cid: references) are resolved to base64 data URIs so they
    render correctly in the browser without needing a mail-client session.
    """
    import base64 as _base64

    plain = ""
    html = ""
    # Map Content-ID → data URI for inline images
    cid_map: dict[str, str] = {}

    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            disp = str(part.get("Content-Disposition", ""))
            if "attachment" in disp:
                continue

            # Collect inline images for cid: resolution
            if ct.startswith("image/"):
                cid = part.get("Content-ID", "").strip().strip("<>")
                payload = part.get_payload(decode=True)
                if cid and payload:
                    b64 = _base64.b64encode(payload).decode("ascii")
                    cid_map[cid] = f"data:{ct};base64,{b64}"
                continue

            charset = part.get_content_charset() or "utf-8"
            if charset.lower() in ("binary", "unknown", "unknown-8bit"):
                charset = "latin-1"
            payload = part.get_payload(decode=True)
            if payload is None:
                continue
            text = payload.decode(charset, errors="replace")
            if ct == "text/plain" and not plain:
                plain = text
            elif ct == "text/html" and not html:
                html = text
    else:
        charset = msg.get_content_charset() or "utf-8"
        payload = msg.get_payload(decode=True)
        if payload:
            text = payload.decode(charset, errors="replace")
            if msg.get_content_type() == "text/html" or _looks_like_html(text):
                html = text
            else:
                plain = text

    # Replace cid: references with base64 data URIs
    if html and cid_map:
        for cid, data_uri in cid_map.items():
            html = html.replace(f"cid:{cid}", data_uri)
        log.debug("_extract_body: resolved %d cid: image(s)", len(cid_map))

    has_genuine_plain = bool(plain)
    plain_out = plain.strip() if plain else (_strip_html(html) if html else "")
    return plain_out, html.strip(), has_genuine_plain


# ── Cache helpers ─────────────────────────────────────────────────────────────

_SYNC_STATE_FILE = _CACHE_DIR / "sync_state.json"
_sync_state_lock = threading.Lock()


def _load_sync_state() -> dict:
    with _sync_state_lock:
        try:
            if _SYNC_STATE_FILE.exists():
                return json.loads(_SYNC_STATE_FILE.read_text())
        except Exception:
            pass
        return {}


def _save_sync_state(state: dict) -> None:
    with _sync_state_lock:
        _SYNC_STATE_FILE.write_text(json.dumps(state, indent=2))


def get_sync_state() -> dict:
    """Public accessor for the sync state (last_synced per folder, etc.)."""
    return _load_sync_state()


def _email_path(email_id: str) -> Path:
    return _CACHE_DIR / f"{email_id}.json"


def _save_email(data: dict) -> None:
    _email_path(data["id"]).write_text(json.dumps(data, ensure_ascii=False, indent=2))


def load_email(email_id: str) -> dict | None:
    p = _email_path(email_id)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


_EMAIL_META_KEYS = ("id", "message_id", "from", "subject", "date", "read", "triaged",
                    "triage_priority", "triage_note", "triage_actions", "flagged", "folder")

# Map lowercase IMAP folder names → canonical display name stored in cache.
# Canonical names are what the frontend tab IDs use.
_CANONICAL_FOLDER: dict[str, str] = {
    "inbox":               "INBOX",
    "sent messages":       "Sent",
    "sent":                "Sent",
    "[gmail]/sent mail":   "Sent",
    "deleted messages":    "Trash",
    "trash":               "Trash",
    "[gmail]/trash":       "Trash",
    "bin":                 "Trash",
    "archive":             "Archive",
    "[gmail]/all mail":    "Archive",
    "all mail":            "Archive",
    "junk":                "Junk",
    "spam":                "Junk",
    "junk email":          "Junk",
    "[gmail]/spam":        "Junk",
}

# Cached IMAP folder discovery result: canonical key → actual IMAP folder name
_special_folders: dict[str, str] = {}


def _extract_attachments(msg: email_lib.message.Message, email_id: str) -> list[dict]:
    """
    Extract and save attachments from a parsed email message.
    Files are saved to _ATTACH_DIR/{email_id}/{safe_filename}.
    Returns a list of attachment metadata dicts.
    """
    results: list[dict] = []
    if not msg.is_multipart():
        return results

    seen: set[str] = set()
    for part in msg.walk():
        disp = str(part.get("Content-Disposition", ""))
        if "attachment" not in disp:
            continue

        raw_name = part.get_filename() or ""
        filename = _decode_header(raw_name).strip()
        if not filename:
            continue

        # Sanitise: keep printable ASCII, replace problem chars
        safe_name = re.sub(r'[^\w\-_\. ]', '_', filename).strip()
        if not safe_name:
            continue

        # Deduplicate within one email
        base, _, ext = safe_name.rpartition(".")
        counter = 0
        candidate = safe_name
        while candidate in seen:
            counter += 1
            candidate = f"{base}_{counter}.{ext}" if ext else f"{safe_name}_{counter}"
        safe_name = candidate
        seen.add(safe_name)

        payload = part.get_payload(decode=True)
        if not payload:
            continue

        attach_dir = _ATTACH_DIR / email_id
        attach_dir.mkdir(parents=True, exist_ok=True)
        (attach_dir / safe_name).write_bytes(payload)

        results.append({
            "filename": safe_name,
            "original_filename": filename,
            "content_type": part.get_content_type(),
            "size": len(payload),
        })

    return results


def _imap_name(folder: str) -> str:
    """Return an IMAP-safe folder name: double-quoted if it contains spaces."""
    if " " in folder:
        return f'"{folder}"'
    return folder


def _discover_special_folders() -> dict[str, str]:
    """
    Query IMAP LIST to find actual folder names for Sent, Trash, and Archive.
    Results are cached in-process. Returns canonical_key → imap_folder_name dict.
    """
    global _special_folders
    if _special_folders:
        return _special_folders

    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled") or not cfg.get("imap_host"):
        return {}

    try:
        conn = _imap_connect()
        _, folders_raw = conn.list()  # LIST "" "*" — default args avoid iCloud BAD errors
        conn.logout()

        found: dict[str, str] = {}
        # RFC 6154 special-use flags take priority over name matching
        rfc6154: dict[str, str] = {
            r"\trash":   "trash",
            r"\sent":    "sent",
            r"\archive": "archive",
            r"\all":     "archive",
            r"\junk":    "junk",
        }
        name_patterns: list[tuple[str, list[str]]] = [
            ("trash",   ["deleted messages", "trash", "[gmail]/trash", "bin"]),
            ("sent",    ["sent messages", "sent", "[gmail]/sent mail"]),
            ("archive", ["archive", "[gmail]/all mail", "all mail"]),
            ("junk",    ["junk", "spam", "junk email", "[gmail]/spam"]),
        ]

        for item in folders_raw or []:
            if not item:
                continue
            line = item.decode() if isinstance(item, bytes) else item
            # Parse:  (\Flag1 \Flag2) "/" "Folder Name"
            m = re.search(r'"([^"]+)"\s*$', line)
            name = m.group(1) if m else line.rsplit(None, 1)[-1].strip('"')
            lower = name.lower()
            # Check RFC 6154 flags first
            flags_match = re.search(r'\(([^)]*)\)', line)
            if flags_match:
                for flag in flags_match.group(1).lower().split():
                    key = rfc6154.get(flag)
                    if key and key not in found:
                        found[key] = name
            # Fall back to name matching
            for key, candidates in name_patterns:
                if key not in found and lower in candidates:
                    found[key] = name

        _special_folders = found
        log.info("Discovered special folders: %s", found)
        return found

    except Exception:
        log.exception("_discover_special_folders failed")
        return {}


def list_emails(limit: int = 50) -> list[dict]:
    """Return cached emails newest-first (metadata only, no body)."""
    items: list[dict] = []
    for p in _CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(p.read_text())
            if not data.get("id"):
                continue
            items.append({k: data.get(k) for k in _EMAIL_META_KEYS})
        except Exception:
            pass
    items.sort(key=lambda e: e.get("date") or "", reverse=True)
    return items[:limit]


def list_emails_by_folder(folder: str = "INBOX", limit: int = 100) -> list[dict]:
    """Return cached emails for a specific folder, newest-first (metadata only)."""
    norm = folder.upper()
    items: list[dict] = []
    for p in _CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(p.read_text())
            if not data.get("id"):
                continue
            cached_folder = (data.get("folder") or "INBOX").upper()
            if cached_folder == norm:
                items.append({k: data.get(k) for k in _EMAIL_META_KEYS})
        except Exception:
            pass
    items.sort(key=lambda e: e.get("date") or "", reverse=True)
    return items[:limit]


def list_untriaged_emails(limit: int = 100) -> list[dict]:
    """Return cached inbox emails not yet triaged, oldest-first."""
    items = []
    for p in _CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(p.read_text())
            if not data.get("id") or data.get("triaged"):
                continue
            items.append({k: data.get(k) for k in ("id", "from", "subject", "date")})
        except Exception:
            pass
    items.sort(key=lambda e: e.get("date") or "")
    return items[:limit]


# ── Semantic search / embeddings ──────────────────────────────────────────────

def _get_embedding(text: str) -> list[float] | None:
    """Call Ollama embeddings API. Returns None on failure."""
    try:
        r = httpx.post(
            f"{config.OLLAMA_HOST}/api/embeddings",
            json={"model": config.EMBED_MODEL, "prompt": text},
            timeout=30.0,
        )
        r.raise_for_status()
        return r.json().get("embedding")
    except Exception:
        log.warning("Embedding call failed: %s", text[:60])
        return None


def _build_embed_text(data: dict) -> str:
    """Compact text representation of an email for embedding."""
    actions = data.get("triage_actions") or []
    actions_str = " ".join(actions) if isinstance(actions, list) else str(actions)
    parts = [
        data.get("subject", ""),
        data.get("from", ""),
        data.get("triage_note", "") or "",
        actions_str,
        (data.get("body", "") or "")[:1000],
    ]
    return " ".join(p for p in parts if p).strip()


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    return dot / (norm_a * norm_b) if norm_a and norm_b else 0.0


def embed_email(email_id: str) -> bool:
    """Generate and persist an embedding for a cached email. Returns True on success."""
    data = load_email(email_id)
    if data is None:
        return False
    text = _build_embed_text(data)
    if not text:
        return False
    vec = _get_embedding(text)
    if vec is None:
        return False
    data["embedding"] = vec
    _save_email(data)
    return True


def embed_all_emails() -> dict:
    """Backfill embeddings for all cached emails that don't have one yet."""
    total = skipped = succeeded = failed = 0
    for p in _CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(p.read_text())
        except Exception:
            continue
        total += 1
        if data.get("embedding"):
            skipped += 1
            continue
        if embed_email(data["id"]):
            succeeded += 1
        else:
            failed += 1
    log.info("embed_all: total=%d skipped=%d ok=%d failed=%d", total, skipped, succeeded, failed)
    return {"total": total, "skipped": skipped, "succeeded": succeeded, "failed": failed}


def search_emails(q: str, limit: int = 50) -> list[dict]:
    """Semantic search across cached emails using Ollama embeddings.
    Falls back to keyword match for any email that hasn't been embedded yet."""
    q = q.strip()
    if not q:
        return list_emails(limit)

    query_vec = _get_embedding(q)
    needle = q.lower()

    scored: list[tuple[float, dict]] = []
    for p in _CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(p.read_text())
        except Exception:
            continue

        meta = {k: data.get(k) for k in _EMAIL_META_KEYS}
        embedding = data.get("embedding")

        if query_vec and embedding:
            score = _cosine(query_vec, embedding)
        else:
            # Keyword fallback for un-embedded emails
            haystack = " ".join(filter(None, [
                data.get("from", ""),
                data.get("subject", ""),
                data.get("body", ""),
                data.get("triage_note", ""),
                " ".join(data.get("triage_actions") or []),
            ])).lower()
            score = 0.5 if needle in haystack else 0.0  # keyword hits ranked below semantic

        scored.append((score, meta))

    scored.sort(key=lambda x: x[0], reverse=True)

    if query_vec and scored:
        # Dynamic cutoff: keep only emails within 0.10 of the top score, and above 0.50 absolute
        top_score = scored[0][0]
        cutoff = max(0.50, top_score - 0.10)
        log.debug("search '%s': top=%.3f cutoff=%.3f candidates=%d", q, top_score, cutoff, len(scored))
        scored = [(s, m) for s, m in scored if s >= cutoff]
    else:
        # Keyword mode: only include actual matches
        scored = [(s, m) for s, m in scored if s > 0]

    return [m for _, m in scored[:limit]]


def refresh_email_body(email_id: str) -> dict | None:
    """
    Re-fetch the full email from IMAP and update the cached html_body.
    Returns the updated record, or None if IMAP is not configured / email not found.
    """
    data = load_email(email_id)
    if data is None:
        return None

    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled") or not cfg.get("imap_host") or not cfg.get("username"):
        return None

    try:
        conn = _imap_connect()
        mailbox = data.get("imap_mailbox") or cfg.get("mailbox", "INBOX")
        conn.select(_imap_name(mailbox))

        # Find the IMAP UID
        imap_uid: str | None = data.get("imap_uid")
        if not imap_uid:
            message_id = data.get("message_id", "")
            if message_id:
                _, uid_data = conn.uid("search", None, f'HEADER Message-ID "{message_id}"')
                if uid_data and uid_data[0]:
                    parts = uid_data[0].split()
                    if parts:
                        imap_uid = parts[-1].decode()

        if not imap_uid:
            conn.logout()
            log.warning("refresh_email_body: UID not found for %s", email_id)
            return None

        _, msg_data = conn.uid("fetch", imap_uid.encode(), "(BODY.PEEK[])")
        raw_tuple = next((item for item in msg_data if isinstance(item, tuple)), None)
        if raw_tuple is None:
            conn.logout()
            return None

        msg = email_lib.message_from_bytes(raw_tuple[1])
        body_plain, body_html, has_genuine_plain = _extract_body(msg)

        data["body"] = body_plain[:20000]
        data["html_body"] = body_html[:500000]
        data["has_genuine_plain"] = has_genuine_plain
        data["imap_uid"] = imap_uid
        data["attachments"] = _extract_attachments(msg, email_id)
        _save_email(data)
        conn.logout()
        log.info("refresh_email_body: updated html_body for %s", email_id)
        return data

    except Exception:
        log.exception("refresh_email_body failed for %s", email_id)
        return None


def deduplicate_cache() -> dict:
    """
    Scan the email cache and remove duplicate files with the same message_id.
    Keeps the copy that has triage data; if both/neither do, keeps the older
    file (earlier mtime). Returns a summary dict.
    """
    from collections import defaultdict

    by_mid: dict[str, list[Path]] = defaultdict(list)
    for p in _CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(p.read_text())
            mid = data.get("message_id") or ""
            if mid:
                by_mid[mid].append(p)
        except Exception:
            pass

    removed = 0
    for mid, paths in by_mid.items():
        if len(paths) <= 1:
            continue
        # Prefer the copy with a triage_note or triage_priority, then oldest mtime
        def score(p: Path) -> tuple[int, float]:
            try:
                d = json.loads(p.read_text())
                has_triage = bool(d.get("triage_note") or d.get("triage_priority"))
                return (0 if has_triage else 1, p.stat().st_mtime)
            except Exception:
                return (2, 0.0)

        paths_sorted = sorted(paths, key=score)
        keep = paths_sorted[0]
        for dup in paths_sorted[1:]:
            try:
                dup.unlink()
                log.info("deduplicate_cache: removed duplicate %s (kept %s)", dup.name, keep.name)
                removed += 1
            except Exception:
                log.exception("deduplicate_cache: failed to remove %s", dup)

    log.info("deduplicate_cache: removed %d duplicate file(s)", removed)
    return {"removed": removed}


def list_flagged(limit: int = 200) -> list[dict]:
    """Return flagged emails newest-first (metadata only)."""
    items: list[dict] = []
    for p in _CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(p.read_text())
            if data.get("flagged"):
                items.append({k: data.get(k) for k in _EMAIL_META_KEYS})
        except Exception:
            pass
    items.sort(key=lambda e: e.get("date") or "", reverse=True)
    return items[:limit]


def flag_email(email_id: str, flagged: bool) -> tuple[bool, str]:
    """Set or clear the IMAP \\Flagged flag. Updates local cache regardless of IMAP status."""
    data = load_email(email_id)
    if data is None:
        return False, "Email not found"

    cfg = config.EMAIL_CONFIG
    imap_ok = False

    if cfg.get("enabled") and cfg.get("imap_host") and cfg.get("username"):
        try:
            conn = _imap_connect()
            mailbox = data.get("imap_mailbox") or cfg.get("mailbox", "INBOX")
            conn.select(_imap_name(mailbox))

            # Find the IMAP UID — prefer stored, fall back to SEARCH by Message-ID
            imap_uid: str | None = data.get("imap_uid")
            if not imap_uid:
                message_id = data.get("message_id", "")
                if message_id:
                    _, uid_data = conn.uid("search", None, f'HEADER Message-ID "{message_id}"')
                    if uid_data and uid_data[0]:
                        parts = uid_data[0].split()
                        if parts:
                            imap_uid = parts[-1].decode()

            if imap_uid:
                flag_op = "+FLAGS" if flagged else "-FLAGS"
                uid_bytes = imap_uid.encode() if isinstance(imap_uid, str) else imap_uid
                conn.uid("store", uid_bytes, flag_op, "(\\Flagged)")
                if not data.get("imap_uid"):
                    data["imap_uid"] = imap_uid
                imap_ok = True
                log.info("flag_email: IMAP %s \\Flagged on uid=%s for %s", flag_op, imap_uid, email_id)
            else:
                log.warning("flag_email: could not find IMAP UID for %s — local cache only", email_id)

            conn.logout()
        except Exception:
            log.exception("flag_email: IMAP error for %s", email_id)

    data["flagged"] = flagged
    _save_email(data)
    msg = "ok" if imap_ok else ("updated locally (IMAP not configured)" if not cfg.get("enabled") else "updated locally (IMAP error)")
    return True, msg


def mark_email_read(email_id: str) -> bool:
    data = load_email(email_id)
    if data is None:
        return False
    data["read"] = True
    _save_email(data)
    return True


def set_email_read(email_id: str, read: bool) -> tuple[bool, str]:
    """Set or clear the IMAP \\Seen flag. Updates local cache regardless of IMAP status."""
    data = load_email(email_id)
    if data is None:
        return False, "Email not found"

    cfg = config.EMAIL_CONFIG
    imap_ok = False

    if cfg.get("enabled") and cfg.get("imap_host") and cfg.get("username"):
        try:
            conn = _imap_connect()
            mailbox = data.get("imap_mailbox") or cfg.get("mailbox", "INBOX")
            conn.select(_imap_name(mailbox))

            imap_uid: str | None = data.get("imap_uid")
            if not imap_uid:
                message_id = data.get("message_id", "")
                if message_id:
                    _, uid_data = conn.uid("search", None, f'HEADER Message-ID "{message_id}"')
                    if uid_data and uid_data[0]:
                        parts = uid_data[0].split()
                        if parts:
                            imap_uid = parts[-1].decode()

            if imap_uid:
                flag_op = "+FLAGS" if read else "-FLAGS"
                uid_bytes = imap_uid.encode() if isinstance(imap_uid, str) else imap_uid
                conn.uid("store", uid_bytes, flag_op, "(\\Seen)")
                if not data.get("imap_uid"):
                    data["imap_uid"] = imap_uid
                imap_ok = True
                log.info("set_email_read: IMAP %s \\Seen on uid=%s for %s", flag_op, imap_uid, email_id)
            else:
                log.warning("set_email_read: could not find IMAP UID for %s — local cache only", email_id)

            conn.logout()
        except Exception:
            log.exception("set_email_read: IMAP error for %s", email_id)

    data["read"] = read
    _save_email(data)
    msg = "ok" if imap_ok else ("updated locally (IMAP not configured)" if not cfg.get("enabled") else "updated locally (IMAP error)")
    return True, msg


def move_email(email_id: str, imap_dest: str) -> tuple[bool, str]:
    """
    Move an email to imap_dest (actual IMAP folder name) via MOVE or COPY+DELETE.
    Stores the canonical display name in the local cache's 'folder' field.
    """
    data = load_email(email_id)
    if data is None:
        return False, "Email not found"

    cfg = config.EMAIL_CONFIG
    canonical_dest = _CANONICAL_FOLDER.get(imap_dest.lower(), imap_dest)

    if not cfg.get("enabled") or not cfg.get("imap_host") or not cfg.get("username"):
        data["folder"] = canonical_dest
        data["imap_mailbox"] = imap_dest
        _save_email(data)
        return True, "updated locally (IMAP not configured)"

    try:
        conn = _imap_connect()
        # Use stored imap_mailbox (actual IMAP name) to SELECT, not canonical folder
        source_imap = data.get("imap_mailbox") or data.get("folder") or cfg.get("mailbox", "INBOX")
        status, _ = conn.select(_imap_name(source_imap))
        if status != "OK":
            conn.logout()
            return False, f"Could not SELECT source mailbox '{source_imap}'"

        imap_uid: str | None = data.get("imap_uid")
        if not imap_uid:
            message_id = data.get("message_id", "")
            if message_id:
                _, uid_data = conn.uid("search", None, f'HEADER Message-ID "{message_id}"')
                if uid_data and uid_data[0]:
                    parts = uid_data[0].split()
                    if parts:
                        imap_uid = parts[-1].decode()

        if not imap_uid:
            log.warning("move_email: UID not found for %s — local cache only", email_id)
            data["folder"] = canonical_dest
            data["imap_mailbox"] = imap_dest
            _save_email(data)
            conn.logout()
            return True, "updated locally (IMAP UID not found)"

        uid_bytes = imap_uid.encode() if isinstance(imap_uid, str) else imap_uid
        imap_dest_arg = _imap_name(imap_dest)

        # Try UID MOVE (RFC 6851) first
        move_ok = False
        try:
            typ, _ = conn.uid("move", uid_bytes, imap_dest_arg)
            if typ == "OK":
                move_ok = True
                log.info("move_email: MOVE uid=%s → %s", imap_uid, imap_dest)
        except (imaplib.IMAP4.error, Exception):
            pass

        if not move_ok:
            # Fall back to COPY + DELETE + EXPUNGE
            typ, _ = conn.uid("copy", uid_bytes, imap_dest_arg)
            if typ != "OK":
                conn.logout()
                return False, f"COPY to '{imap_dest}' failed"
            conn.uid("store", uid_bytes, "+FLAGS", "(\\Deleted)")
            conn.expunge()
            log.info("move_email: COPY+DELETE uid=%s → %s", imap_uid, imap_dest)

        conn.logout()

        data["folder"] = canonical_dest
        data["imap_mailbox"] = imap_dest
        if not data.get("imap_uid"):
            data["imap_uid"] = imap_uid
        _save_email(data)
        return True, "ok"

    except Exception:
        log.exception("move_email failed for %s", email_id)
        return False, "IMAP error"


def archive_email(email_id: str) -> tuple[bool, str]:
    """Move email to the archive folder (auto-discovered or config override)."""
    cfg = config.EMAIL_CONFIG
    folders = _discover_special_folders()
    imap_folder = folders.get("archive") or cfg.get("archive_folder", "Archive")
    return move_email(email_id, imap_folder)


def trash_email(email_id: str) -> tuple[bool, str]:
    """Move email to the trash folder (auto-discovered or config override)."""
    cfg = config.EMAIL_CONFIG
    folders = _discover_special_folders()
    imap_folder = folders.get("trash") or cfg.get("trash_folder", "Trash")
    return move_email(email_id, imap_folder)


def junk_email(email_id: str) -> tuple[bool, str]:
    """Move email to the junk/spam folder (auto-discovered or config override)."""
    cfg = config.EMAIL_CONFIG
    folders = _discover_special_folders()
    imap_folder = folders.get("junk") or cfg.get("junk_folder", "Junk")
    return move_email(email_id, imap_folder)


# ── Sync helpers ──────────────────────────────────────────────────────────────

def _clear_folder_cache(canonical_folder: str) -> int:
    """Remove all cached emails for a folder. Used on UIDVALIDITY change."""
    norm = canonical_folder.upper()
    removed = 0
    for p in _CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(p.read_text())
            if (data.get("folder") or "INBOX").upper() == norm:
                p.unlink()
                removed += 1
        except Exception:
            pass
    log.info("_clear_folder_cache: removed %d email(s) from %s", removed, canonical_folder)
    return removed


def get_cached_uids_for_folder(imap_mailbox: str) -> dict[str, str]:
    """Return {imap_uid: email_id} for all cached emails in a given IMAP mailbox."""
    result: dict[str, str] = {}
    for p in _CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(p.read_text())
            if data.get("imap_mailbox") == imap_mailbox and data.get("imap_uid"):
                result[str(data["imap_uid"])] = data["id"]
        except Exception:
            pass
    return result


def incremental_fetch(
    conn: imaplib.IMAP4 | imaplib.IMAP4_SSL,
    imap_mailbox: str,
    canonical_folder: str,
    cfg: dict,
    *,
    mark_read: bool = False,
    skip_triage: bool = False,
) -> list[dict]:
    """
    Fetch only emails with UIDs greater than the last known UID for this mailbox.
    Updates sync state on success. Returns list of newly-cached email metadata dicts.
    If UIDVALIDITY changed, clears the folder cache and re-fetches from scratch.

    Must be called under _fetch_lock to prevent duplicate caching from concurrent callers.
    """
    status, select_data = conn.select(_imap_name(imap_mailbox))
    if status != "OK":
        raise imaplib.IMAP4.error(f"SELECT '{imap_mailbox}' failed")

    # Parse UIDVALIDITY from SELECT response untagged lines
    uidvalidity: str | None = None
    for item in select_data or []:
        if not item:
            continue
        s = item.decode(errors="replace") if isinstance(item, bytes) else str(item)
        m = re.search(r'\[UIDVALIDITY (\d+)\]', s)
        if m:
            uidvalidity = m.group(1)
            break

    state = _load_sync_state()
    folder_state = state.get(imap_mailbox, {})
    stored_uidvalidity = folder_state.get("uidvalidity")
    highest_uid: int = int(folder_state.get("highest_uid", 0))

    # UIDVALIDITY mismatch → the mailbox was recreated; wipe local cache and full-resync
    if uidvalidity and stored_uidvalidity and uidvalidity != stored_uidvalidity:
        log.warning(
            "UIDVALIDITY changed for %s (%s → %s) — clearing cache and resyncing",
            imap_mailbox, stored_uidvalidity, uidvalidity,
        )
        _clear_folder_cache(canonical_folder)
        highest_uid = 0

    # Search only for UIDs we haven't seen yet
    if highest_uid:
        _, uid_data = conn.uid("search", None, f"UID {highest_uid + 1}:*")
    else:
        # First-time sync: fetch last fetch_max messages
        _, uid_data = conn.uid("search", None, "ALL")

    if not uid_data or not uid_data[0]:
        _update_sync_state(state, imap_mailbox, uidvalidity, highest_uid)
        return []

    all_uids = uid_data[0].split()
    # Filter to only UIDs strictly above our highest known
    new_uids = [u for u in all_uids if int(u) > highest_uid]

    if not highest_uid:
        # First-time sync: cap to fetch_max, take most recent
        limit = cfg.get("fetch_max", 50)
        new_uids = new_uids[-limit:]

    if not new_uids:
        _update_sync_state(state, imap_mailbox, uidvalidity, highest_uid)
        return []

    # Build dedup set from existing cache
    existing_message_ids: set[str] = {
        json.loads(p.read_text()).get("message_id", "")
        for p in _CACHE_DIR.glob("*.json")
        if p.stat().st_size > 0
    }

    fetched: list[dict] = []
    new_highest = highest_uid

    for num in reversed(new_uids):  # process oldest→newest so highest_uid tracks correctly
        try:
            uid_int = int(num)
            _, msg_data = conn.uid("fetch", num, "(FLAGS BODY.PEEK[])")
            raw_tuple = next((item for item in msg_data if isinstance(item, tuple)), None)
            if raw_tuple is None:
                continue

            # raw_tuple[0] = FETCH header (UID, FLAGS); raw_tuple[1] = raw message bytes
            fetch_header = raw_tuple[0].decode(errors="replace") if isinstance(raw_tuple[0], bytes) else str(raw_tuple[0])
            raw_msg = raw_tuple[1]

            is_read = "\\Seen" in fetch_header
            is_flagged = "\\Flagged" in fetch_header

            msg = email_lib.message_from_bytes(raw_msg)
            message_id = _decode_header(msg.get("Message-ID", "")).strip()
            if message_id in existing_message_ids:
                new_highest = max(new_highest, uid_int)
                continue

            date_str = msg.get("Date", "")
            try:
                dt = parsedate_to_datetime(date_str)
                date_iso = dt.astimezone(timezone.utc).isoformat()
            except Exception:
                date_iso = datetime.now(timezone.utc).isoformat()

            body_plain, body_html, has_genuine_plain = _extract_body(msg)
            email_id = str(uuid.uuid4())
            record: dict = {
                "id": email_id,
                "message_id": message_id,
                "imap_uid": str(uid_int),
                "imap_mailbox": imap_mailbox,
                "from": _decode_header(msg.get("From", "")),
                "to": _decode_header(msg.get("To", "")),
                "subject": _decode_header(msg.get("Subject", "(no subject)")),
                "date": date_iso,
                "body": body_plain[:20000],
                "html_body": body_html[:500000],
                "has_genuine_plain": has_genuine_plain,
                "read": is_read or mark_read,
                "triaged": skip_triage,
                "flagged": is_flagged,
                "folder": canonical_folder,
                "triage_result": None,
                "triage_actions": [],
                "attachments": _extract_attachments(msg, email_id),
            }
            _save_email(record)
            existing_message_ids.add(message_id)
            new_highest = max(new_highest, uid_int)

            vec = _get_embedding(_build_embed_text(record))
            if vec:
                record["embedding"] = vec
                _save_email(record)

            fetched.append({k: record.get(k) for k in _EMAIL_META_KEYS})
            log.info("Synced [%s] uid=%s: %s — %s", canonical_folder, uid_int,
                     record["from"][:30], record["subject"][:40])

        except Exception:
            log.exception("incremental_fetch: failed on uid %s in %s", num, imap_mailbox)

    _update_sync_state(state, imap_mailbox, uidvalidity, new_highest)
    return fetched


def _update_sync_state(state: dict, imap_mailbox: str, uidvalidity: str | None, highest_uid: int) -> None:
    folder_state = state.get(imap_mailbox, {})
    if uidvalidity:
        folder_state["uidvalidity"] = uidvalidity
    if highest_uid:
        folder_state["highest_uid"] = highest_uid
    folder_state["last_synced"] = datetime.now(timezone.utc).isoformat()
    state[imap_mailbox] = folder_state
    _save_sync_state(state)


def expunge_check(
    conn: imaplib.IMAP4 | imaplib.IMAP4_SSL,
    imap_mailbox: str,
    canonical_folder: str,
) -> int:
    """
    Detect emails deleted from the server (by another client) and remove them from local cache.
    Returns count of removed entries.
    """
    try:
        conn.select(_imap_name(imap_mailbox))
        _, uid_data = conn.uid("search", None, "ALL")
        server_uids: set[str] = set()
        if uid_data and uid_data[0]:
            server_uids = {
                u.decode() if isinstance(u, bytes) else str(u)
                for u in uid_data[0].split()
            }

        cached = get_cached_uids_for_folder(imap_mailbox)
        removed = 0
        for uid, email_id in cached.items():
            if uid not in server_uids:
                p = _email_path(email_id)
                if p.exists():
                    p.unlink()
                    log.info("expunge_check: removed %s (uid=%s gone from %s)", email_id, uid, imap_mailbox)
                    removed += 1
        return removed
    except Exception:
        log.exception("expunge_check failed for %s", imap_mailbox)
        return 0


def flag_sync(
    conn: imaplib.IMAP4 | imaplib.IMAP4_SSL,
    imap_mailbox: str,
    canonical_folder: str,
) -> int:
    """
    Pull current \\Seen and \\Flagged flags from the server for all cached emails in this mailbox.
    Updates local cache where flags differ (e.g. read on phone, flagged in another client).
    Returns count of updated emails.
    """
    cached = get_cached_uids_for_folder(imap_mailbox)
    if not cached:
        return 0

    try:
        conn.select(_imap_name(imap_mailbox))
        uid_list = ",".join(cached.keys())
        _, flag_data = conn.uid("fetch", uid_list, "(FLAGS)")

        server_flags: dict[str, tuple[bool, bool]] = {}  # uid → (read, flagged)
        for item in flag_data or []:
            if not isinstance(item, bytes):
                continue
            s = item.decode(errors="replace")
            uid_m = re.search(r'UID (\d+)', s)
            if not uid_m:
                continue
            uid = uid_m.group(1)
            server_flags[uid] = ("\\Seen" in s, "\\Flagged" in s)

        updated = 0
        for uid, email_id in cached.items():
            if uid not in server_flags:
                continue
            server_read, server_flagged = server_flags[uid]
            data = load_email(email_id)
            if data is None:
                continue
            changed = False
            if data.get("read") != server_read:
                data["read"] = server_read
                changed = True
            if data.get("flagged") != server_flagged:
                data["flagged"] = server_flagged
                changed = True
            if changed:
                _save_email(data)
                updated += 1

        if updated:
            log.info("flag_sync [%s]: updated flags on %d email(s)", imap_mailbox, updated)
        return updated

    except Exception:
        log.exception("flag_sync failed for %s", imap_mailbox)
        return 0


# ── IMAP fetch ────────────────────────────────────────────────────────────────

def _imap_connect() -> imaplib.IMAP4 | imaplib.IMAP4_SSL:
    cfg = config.EMAIL_CONFIG
    host = cfg["imap_host"]
    port = int(cfg["imap_port"])
    if cfg.get("imap_ssl", True):
        conn = imaplib.IMAP4_SSL(host, port)
    else:
        conn = imaplib.IMAP4(host, port)
    conn.login(cfg["username"], cfg["password"])
    return conn


def _fetch_from_mailbox(
    conn: imaplib.IMAP4 | imaplib.IMAP4_SSL,
    imap_mailbox: str,
    canonical_folder: str,
    limit: int,
    cfg: dict,
    *,
    mark_read: bool = False,
    skip_triage: bool = False,
) -> list[dict]:
    """
    Fetch recent emails from a single IMAP mailbox into the local cache.
    Returns list of newly fetched metadata dicts.
    """
    status, select_data = conn.select(_imap_name(imap_mailbox))
    if status != "OK":
        raise imaplib.IMAP4.error(
            f"SELECT '{imap_mailbox}' failed: "
            f"{select_data[0].decode(errors='replace') if select_data else 'unknown error'}"
        )

    _, data = conn.uid("search", None, "ALL")
    msg_ids = data[0].split()
    msg_ids = msg_ids[-limit:][::-1]

    fetched: list[dict] = []
    existing_message_ids: set[str] = {
        json.loads(p.read_text()).get("message_id", "")
        for p in _CACHE_DIR.glob("*.json")
        if p.stat().st_size > 0
    }

    for num in msg_ids:
        try:
            _, msg_data = conn.uid("fetch", num, "(FLAGS BODY.PEEK[])")
            raw_tuple = next((item for item in msg_data if isinstance(item, tuple)), None)
            if raw_tuple is None:
                log.warning("fetch: no body data for uid %s — raw: %r", num, msg_data)
                continue
            fetch_header = raw_tuple[0].decode(errors="replace") if isinstance(raw_tuple[0], bytes) else str(raw_tuple[0])
            raw = raw_tuple[1]
            msg = email_lib.message_from_bytes(raw)

            message_id = _decode_header(msg.get("Message-ID", "")).strip()
            if message_id in existing_message_ids:
                continue

            date_str = msg.get("Date", "")
            try:
                dt = parsedate_to_datetime(date_str)
                date_iso = dt.astimezone(timezone.utc).isoformat()
            except Exception:
                date_iso = datetime.now(timezone.utc).isoformat()

            body_plain, body_html, has_genuine_plain = _extract_body(msg)

            email_id = str(uuid.uuid4())
            record: dict = {
                "id": email_id,
                "message_id": message_id,
                "imap_uid": num.decode() if isinstance(num, bytes) else str(num),
                "imap_mailbox": imap_mailbox,
                "from": _decode_header(msg.get("From", "")),
                "to": _decode_header(msg.get("To", "")),
                "subject": _decode_header(msg.get("Subject", "(no subject)")),
                "date": date_iso,
                "body": body_plain[:20000],
                "html_body": body_html[:500000],
                "has_genuine_plain": has_genuine_plain,
                "read": ("\\Seen" in fetch_header) or mark_read,
                "triaged": skip_triage,
                "flagged": "\\Flagged" in fetch_header,
                "folder": canonical_folder,
                "triage_result": None,
                "triage_actions": [],
                "attachments": _extract_attachments(msg, email_id),
            }
            _save_email(record)
            existing_message_ids.add(message_id)
            vec = _get_embedding(_build_embed_text(record))
            if vec:
                record["embedding"] = vec
                _save_email(record)
            fetched.append({k: record.get(k) for k in ("id", "message_id", "from", "subject", "date", "read", "triaged", "triage_priority", "triage_note")})
            log.info("Cached email [%s]: %s — %s", canonical_folder, record["from"], record["subject"])

        except Exception:
            log.exception("Failed to process message %s", num)

    return fetched


def fetch_emails(max_count: int | None = None) -> list[dict]:
    """
    Fetch recent emails from IMAP (inbox + sent) and cache locally.
    Returns list of newly fetched email metadata dicts.
    Returns empty list if email is disabled or credentials missing.

    Serialized via _fetch_lock so concurrent callers (IDLE thread, triage
    scheduler, manual button) cannot race and write the same email twice.
    """
    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled") or not cfg.get("imap_host") or not cfg.get("username"):
        log.debug("Email not configured or disabled, skipping fetch")
        return []

    with _fetch_lock:
        limit = max_count or cfg.get("fetch_max", 50)
        fetched: list[dict] = []
        special = _discover_special_folders()

        try:
            conn = _imap_connect()

            # Fetch inbox
            inbox_mailbox = cfg.get("mailbox", "INBOX")
            fetched += _fetch_from_mailbox(conn, inbox_mailbox, "INBOX", limit, cfg)

            # Fetch sent (if discoverable)
            sent_mailbox = special.get("sent")
            if sent_mailbox:
                try:
                    fetched += _fetch_from_mailbox(
                        conn, sent_mailbox, "Sent", limit, cfg,
                        mark_read=True, skip_triage=True,
                    )
                except Exception:
                    log.warning("Could not fetch sent folder '%s'", sent_mailbox)

            conn.logout()
            log.info("Fetched %d new emails total", len(fetched))

        except Exception:
            log.exception("IMAP fetch failed")

        return fetched


def list_imap_folders() -> list[dict]:
    """
    Return all selectable IMAP folders with display names and roles.
    Each entry: {imap_name, display_name, role}
    Roles: "inbox" | "sent" | "trash" | "archive" | "folder"
    display_name is what gets stored in the email cache's 'folder' field.
    """
    cfg = config.EMAIL_CONFIG
    inbox_mailbox = cfg.get("mailbox", "INBOX")

    if not cfg.get("enabled") or not cfg.get("imap_host"):
        return [{"imap_name": inbox_mailbox, "display_name": "Inbox", "role": "inbox"}]

    special = _discover_special_folders()  # {trash: "Deleted Messages", sent: "Sent Messages", ...}
    imap_to_role = {v: k for k, v in special.items()}
    role_display = {"inbox": "Inbox", "sent": "Sent", "trash": "Trash", "archive": "Archive", "junk": "Junk"}
    skip_lower = {"notes", "com.apple.mail.pka"}  # non-email folders to hide
    role_order = {"inbox": 0, "sent": 1, "archive": 2, "trash": 3, "junk": 4, "folder": 5}

    try:
        conn = _imap_connect()
        _, folders_raw = conn.list()
        conn.logout()

        result: list[dict] = []
        seen_display: set[str] = set()

        for item in folders_raw or []:
            if not item:
                continue
            line = item.decode() if isinstance(item, bytes) else item
            m = re.search(r'"([^"]+)"\s*$', line)
            imap_name = m.group(1) if m else line.rsplit(None, 1)[-1].strip('"')

            if imap_name.lower() in skip_lower:
                continue

            # Skip non-selectable folders
            flags_match = re.search(r'\(([^)]*)\)', line)
            flags_lower = flags_match.group(1).lower() if flags_match else ""
            if r"\noselect" in flags_lower:
                continue

            role = imap_to_role.get(imap_name)
            if imap_name == inbox_mailbox or imap_name.upper() == "INBOX":
                role = "inbox"

            display_name = role_display.get(role or "", imap_name)
            if display_name in seen_display:
                continue
            seen_display.add(display_name)

            result.append({"imap_name": imap_name, "display_name": display_name, "role": role or "folder"})

        result.sort(key=lambda f: (role_order.get(f["role"], 4), f["display_name"]))
        return result

    except Exception:
        log.exception("list_imap_folders failed")
        return [{"imap_name": inbox_mailbox, "display_name": "Inbox", "role": "inbox"}]


def fetch_folder(display_name: str, max_count: int = 50) -> tuple[int, str]:
    """
    Fetch emails from a folder by its display name into the local cache.
    Uses list_imap_folders() to resolve the actual IMAP mailbox name.
    Returns (count_fetched, message).
    """
    cfg = config.EMAIL_CONFIG
    if not cfg.get("enabled") or not cfg.get("imap_host") or not cfg.get("username"):
        return 0, "Email not configured"

    folders = list_imap_folders()
    folder_info = next((f for f in folders if f["display_name"].lower() == display_name.lower()), None)
    if not folder_info:
        return 0, f"Folder not found: {display_name}"

    imap_mailbox = folder_info["imap_name"]
    role = folder_info["role"]
    skip_triage = role != "inbox"
    mark_read = role != "inbox"

    try:
        conn = _imap_connect()
        fetched = _fetch_from_mailbox(
            conn, imap_mailbox, folder_info["display_name"], max_count, cfg,
            mark_read=mark_read, skip_triage=skip_triage,
        )
        conn.logout()
        log.info("fetch_folder [%s]: %d new emails", display_name, len(fetched))
        return len(fetched), "ok"
    except Exception:
        log.exception("fetch_folder failed for %s", display_name)
        return 0, "IMAP error"


def test_connection() -> tuple[bool, str]:
    """Test IMAP credentials and verify the configured mailbox. Returns (success, message)."""
    cfg = config.EMAIL_CONFIG
    mailbox = cfg.get("mailbox", "INBOX")
    try:
        conn = _imap_connect()
        # Verify the configured mailbox actually exists
        status, select_data = conn.select(mailbox)
        if status != "OK":
            # List available mailboxes to help the user pick the right name
            _, list_data = conn.list()
            available = []
            for item in list_data or []:
                if isinstance(item, bytes):
                    # e.g. b'(\\HasNoChildren) "/" "INBOX"'
                    parts = item.decode(errors="replace").split('"')
                    name = parts[-2] if len(parts) >= 2 else item.decode(errors="replace")
                    available.append(name)
            conn.logout()
            hint = f" Available mailboxes: {', '.join(available)}" if available else ""
            return False, f"Mailbox '{mailbox}' not found.{hint}"
        msg_count_raw = select_data[0]
        msg_count = msg_count_raw.decode(errors="replace") if isinstance(msg_count_raw, bytes) else str(msg_count_raw)
        conn.logout()
        return True, f"Connected. Mailbox '{mailbox}' OK ({msg_count} messages)"
    except imaplib.IMAP4.error as e:
        return False, f"IMAP error: {e}"
    except Exception as e:
        return False, str(e)
