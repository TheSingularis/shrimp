"""Shared helpers for safe config.py persistence."""
import os
import tempfile
from pathlib import Path


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
