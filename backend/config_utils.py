"""Shared helpers for safe config.py persistence."""
import os
import tempfile
from pathlib import Path


def get_data_dir() -> Path:
    """Return the user-writable data directory.

    In a packaged install the backend runs from a root-owned system directory.
    SHRIMP_DATA_DIR is set by main.js to the user's XDG data dir so that
    mutable data (conversations, notifications) can actually be written.
    """
    env = os.environ.get("SHRIMP_DATA_DIR")
    if env:
        return Path(env)
    return Path(__file__).parent.parent


def get_config_path() -> Path:
    """Return the writable config.py path.

    In a packaged Electron install the backend runs from a root-owned system
    directory. SHRIMP_CONFIG_DIR is set by main.js to the user's XDG data dir
    so settings can actually be saved.
    """
    env = os.environ.get("SHRIMP_CONFIG_DIR")
    if env:
        return Path(env) / "config.py"
    return Path(__file__).parent / "config.py"


def atomic_write(path: Path, content: str) -> None:
    """Write content to path atomically via tempfile + os.replace().

    Prevents config.py corruption if the process is killed mid-write.
    os.replace() is atomic on POSIX; on Windows it is best-effort but still
    safer than a direct write.
    """
    with tempfile.NamedTemporaryFile(
        "w", dir=path.parent, delete=False, suffix=".tmp", encoding="utf-8"
    ) as f:
        f.write(content)
        tmp = f.name
    os.replace(tmp, path)
