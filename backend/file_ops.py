"""
File operations module with security-focused write access control.

All file writes in SHRIMP must go through write_accept() to ensure:
- Path validation (no escaping scope roots)
- Permission checks
- Proper logging
- Atomic writes where possible
- Backup creation for existing files

This is a critical security boundary.
"""

import logging
from pathlib import Path
from datetime import datetime
import shutil
from typing import Optional

import config

log = logging.getLogger("shrimp.file_ops")


class FileOperationError(Exception):
    """Raised when a file operation fails security or validation checks."""
    pass


def write_accept(
    scope: str,
    path: str,
    content: str,
    *,
    create_backup: bool = True,
    encoding: str = "utf-8"
) -> Path:
    """
    Write content to a file with full security validation.

    This is the ONLY approved way to write user files in SHRIMP.

    Args:
        scope: Scope name (must exist in config.WATCHED_DIRS)
        path: Relative path within scope
        content: File content to write
        create_backup: If True, create timestamped backup of existing file
        encoding: Text encoding (default: utf-8)

    Returns:
        Path object of written file

    Raises:
        FileOperationError: If validation fails or write operation fails
        FileNotFoundError: If scope doesn't exist

    Security checks performed:
    1. Scope exists and is configured
    2. Path doesn't escape scope root (no ../ attacks)
    3. Target directory is writable
    4. Backup created before overwriting (if enabled)
    """

    # ── 1. Validate scope exists ──────────────────────────────────────────────
    scope_obj = next(
        (s for s in config.WATCHED_DIRS if s["name"] == scope), None
    )
    if not scope_obj:
        raise FileNotFoundError(f"Scope '{scope}' not found in configuration")

    # ── 2. Resolve paths and validate no escape ───────────────────────────────
    root = Path(scope_obj["path"]).expanduser().resolve()

    if not root.exists():
        raise FileOperationError(f"Scope root does not exist: {root}")

    target = (root / path).resolve()

    # Critical security check: ensure target is within root
    try:
        target.relative_to(root)
    except ValueError:
        raise FileOperationError(
            f"Path '{path}' escapes scope root '{scope}' "
            f"(attempted to access: {target})"
        )

    log.info(f"write_accept: validated path {scope}/{path} -> {target}")

    # ── 3. Create parent directories if needed ────────────────────────────────
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
    except PermissionError as e:
        raise FileOperationError(
            f"Cannot create parent directory for {path}: {e}"
        )

    # ── 4. Create backup if file exists ───────────────────────────────────────
    if create_backup and target.exists():
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = target.parent / f"{target.name}.backup.{timestamp}"

        try:
            shutil.copy2(target, backup_path)
            log.info(f"write_accept: created backup at {backup_path}")
        except Exception as e:
            log.warning(f"write_accept: backup creation failed: {e}")
            # Continue anyway - backup failure shouldn't block the write

    # ── 5. Write file ──────────────────────────────────────────────────────────
    try:
        target.write_text(content, encoding=encoding)
        log.info(
            f"write_accept: wrote {len(content)} chars to {scope}/{path}"
        )
    except PermissionError as e:
        raise FileOperationError(
            f"Permission denied writing to {path}: {e}"
        )
    except OSError as e:
        raise FileOperationError(
            f"Failed to write {path}: {e}"
        )

    return target


def read_file(scope: str, path: str, *, encoding: str = "utf-8") -> str:
    """
    Read a file with security validation.

    Args:
        scope: Scope name
        path: Relative path within scope
        encoding: Text encoding (default: utf-8)

    Returns:
        File content as string

    Raises:
        FileOperationError: If validation fails
        FileNotFoundError: If scope or file doesn't exist
    """
    # Validate scope exists
    scope_obj = next(
        (s for s in config.WATCHED_DIRS if s["name"] == scope), None
    )
    if not scope_obj:
        raise FileNotFoundError(f"Scope '{scope}' not found in configuration")

    # Resolve paths and validate
    root = Path(scope_obj["path"]).expanduser().resolve()
    target = (root / path).resolve()

    # Security check
    try:
        target.relative_to(root)
    except ValueError:
        raise FileOperationError(
            f"Path '{path}' escapes scope root '{scope}'"
        )

    if not target.exists():
        raise FileNotFoundError(f"File not found: {scope}/{path}")

    if not target.is_file():
        raise FileOperationError(f"Not a file: {scope}/{path}")

    log.info(f"read_file: reading {scope}/{path}")
    return target.read_text(encoding=encoding, errors="ignore")


def delete_file(scope: str, path: str) -> None:
    """
    Delete a file with security validation.

    Args:
        scope: Scope name
        path: Relative path within scope

    Raises:
        FileOperationError: If validation fails
        FileNotFoundError: If scope or file doesn't exist
    """
    # Validate scope exists
    scope_obj = next(
        (s for s in config.WATCHED_DIRS if s["name"] == scope), None
    )
    if not scope_obj:
        raise FileNotFoundError(f"Scope '{scope}' not found in configuration")

    # Resolve paths and validate
    root = Path(scope_obj["path"]).expanduser().resolve()
    target = (root / path).resolve()

    # Security check
    try:
        target.relative_to(root)
    except ValueError:
        raise FileOperationError(
            f"Path '{path}' escapes scope root '{scope}'"
        )

    if not target.exists():
        raise FileNotFoundError(f"File not found: {scope}/{path}")

    log.info(f"delete_file: deleting {scope}/{path}")
    target.unlink()


def list_backups(scope: str, path: str) -> list[Path]:
    """
    List all backup files for a given file.

    Args:
        scope: Scope name
        path: Relative path within scope

    Returns:
        List of Path objects for backup files, sorted by modification time (newest first)
    """
    scope_obj = next(
        (s for s in config.WATCHED_DIRS if s["name"] == scope), None
    )
    if not scope_obj:
        return []

    root = Path(scope_obj["path"]).expanduser().resolve()
    target = (root / path).resolve()

    # Security check
    try:
        target.relative_to(root)
    except ValueError:
        return []

    # Find backups in same directory
    parent = target.parent
    pattern = f"{target.name}.backup.*"

    backups = list(parent.glob(pattern))
    backups.sort(key=lambda p: p.stat().st_mtime, reverse=True)

    return backups
