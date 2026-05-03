"""Credential storage: system keyring primary, encrypted file fallback.

Usage:
    from credentials import get_credential, set_credential, delete_credential

Account key convention: "{plugin}-{purpose}", e.g. "email-imap", "email-smtp".
"""
import json
import logging
import os
import stat
from pathlib import Path

log = logging.getLogger("shrimp.credentials")
_SERVICE = "shrimp"

try:
    import keyring
    import keyring.errors
    _KEYRING = True
except ImportError:
    _KEYRING = False
    log.warning("keyring package not installed — using file-based credential storage")


def _fallback_path() -> Path:
    env = os.environ.get("SHRIMP_CONFIG_DIR")
    base = Path(env) if env else Path(__file__).parent
    return base / "credentials.json"


def _read_fallback() -> dict:
    p = _fallback_path()
    try:
        return json.loads(p.read_text()) if p.exists() else {}
    except Exception:
        return {}


def _write_fallback(data: dict) -> None:
    p = _fallback_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data))
    p.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0o600 — owner read/write only


def get_credential(account: str) -> str:
    """Return the stored secret for *account*, or '' if not set."""
    if _KEYRING:
        try:
            val = keyring.get_password(_SERVICE, account)
            if val is not None:
                return val
        except Exception as exc:
            log.debug("keyring get failed (%s) — trying file fallback", exc)
    return _read_fallback().get(account, "")


def set_credential(account: str, secret: str) -> None:
    """Store *secret* under *account*."""
    if _KEYRING:
        try:
            keyring.set_password(_SERVICE, account, secret)
            return
        except Exception as exc:
            log.debug("keyring set failed (%s) — using file fallback", exc)
    data = _read_fallback()
    data[account] = secret
    _write_fallback(data)
    log.debug("credential stored in fallback file: %s", account)


def delete_credential(account: str) -> None:
    """Remove the stored secret for *account*."""
    if _KEYRING:
        try:
            keyring.delete_password(_SERVICE, account)
        except Exception:
            pass
    data = _read_fallback()
    if account in data:
        data.pop(account)
        _write_fallback(data)
