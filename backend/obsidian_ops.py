"""
Obsidian vault operations.

Works directly with the Markdown files on disk — no plugin required.
Reads/writes go through the existing scope + file_ops pattern.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

import config
import file_ops

log = logging.getLogger("shrimp.obsidian_ops")

# Directories that are never useful to expose in the vault browser
_SKIP_DIRS = {".obsidian", ".trash", ".git", "__pycache__", ".DS_Store"}


# ── Scope helpers ─────────────────────────────────────────────────────────────

def _scope_root(scope_name: str) -> Path | None:
    """Return the expanded root Path for a scope, or None if not found."""
    for s in config.WATCHED_DIRS:
        if s["name"] == scope_name:
            return Path(s["path"]).expanduser()
    return None


def _default_obsidian_scope() -> str | None:
    """Return the name of the first scope that looks like an Obsidian vault."""
    # Prefer a scope literally named "obsidian"
    for s in config.WATCHED_DIRS:
        if s["name"].lower() == "obsidian":
            return s["name"]
    # Fall back to any scope whose root contains .obsidian/
    for s in config.WATCHED_DIRS:
        root = Path(s["path"]).expanduser()
        if (root / ".obsidian").is_dir():
            return s["name"]
    return None


# ── Frontmatter parsing ───────────────────────────────────────────────────────

def _parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    """
    Split YAML frontmatter from markdown body.
    Returns (frontmatter_dict, body_without_frontmatter).
    """
    if not text.startswith("---"):
        return {}, text

    end = text.find("---", 3)
    if end == -1:
        return {}, text

    fm_block = text[3:end].strip()
    body = text[end + 3:].lstrip("\n")

    fm: dict[str, str] = {}
    for line in fm_block.splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            fm[key.strip()] = val.strip()

    return fm, body


def _build_frontmatter(fm: dict[str, Any]) -> str:
    if not fm:
        return ""
    lines = ["---"]
    for k, v in fm.items():
        lines.append(f"{k}: {v}")
    lines.append("---")
    return "\n".join(lines) + "\n"


# ── Wikilink validation ───────────────────────────────────────────────────────

def check_wikilinks(content: str, scope_name: str) -> list[str]:
    """Return a list of [[link]] targets that do not resolve to existing pages."""
    root = _scope_root(scope_name)
    if root is None:
        return []

    all_stems = {p.stem.lower() for p in root.rglob("*.md")}
    pattern = re.compile(r"\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]")
    broken: list[str] = []
    for m in pattern.finditer(content):
        target = m.group(1).strip()
        if target.lower() not in all_stems:
            broken.append(target)
    return broken


# ── Page listing ──────────────────────────────────────────────────────────────

def list_vault_pages(scope_name: str | None = None) -> list[dict]:
    """
    Return all .md files in the vault as a flat list, newest-modified first.

    Each item: {path, title, size, modified, has_frontmatter, tags}
    """
    name = scope_name or _default_obsidian_scope()
    if name is None:
        return []
    root = _scope_root(name)
    if root is None or not root.is_dir():
        return []

    results: list[dict] = []
    for p in root.rglob("*.md"):
        # Skip hidden / system directories
        if any(part.startswith(".") or part in _SKIP_DIRS for part in p.parts):
            continue
        try:
            stat = p.stat()
            text = p.read_text(encoding="utf-8", errors="replace")
            fm, _ = _parse_frontmatter(text)
            title = fm.get("title") or p.stem
            tags_raw = fm.get("tags", "")
            tags = [t.strip() for t in re.split(r"[,\s]+", tags_raw) if t.strip()] if tags_raw else []
            results.append({
                "path": str(p.relative_to(root)),
                "title": title,
                "size": stat.st_size,
                "modified": stat.st_mtime,
                "has_frontmatter": bool(fm),
                "tags": tags,
            })
        except Exception:
            log.exception("Failed to stat %s", p)

    results.sort(key=lambda x: x["modified"], reverse=True)
    return results


# ── Page reading ──────────────────────────────────────────────────────────────

def get_page(scope_name: str, rel_path: str) -> dict | None:
    """
    Read a vault page. Returns {path, title, frontmatter, body, content, broken_links}.
    Returns None if the file does not exist.
    """
    root = _scope_root(scope_name)
    if root is None:
        return None
    full = (root / rel_path).resolve()
    # Security: must stay within root
    try:
        full.relative_to(root.resolve())
    except ValueError:
        log.warning("get_page: path escape attempt: %s", rel_path)
        return None
    if not full.exists():
        return None

    content = full.read_text(encoding="utf-8", errors="replace")
    fm, body = _parse_frontmatter(content)
    broken = check_wikilinks(content, scope_name)
    return {
        "path": rel_path,
        "title": fm.get("title") or full.stem,
        "frontmatter": fm,
        "body": body,
        "content": content,
        "broken_links": broken,
    }


# ── Page writing ──────────────────────────────────────────────────────────────

def propose_page_create(
    scope_name: str,
    rel_path: str,
    content: str,
    explanation: str = "Create new Obsidian page",
) -> dict:
    """
    Stage a new page creation through file_ops.write_accept().
    Returns info dict that callers can forward as a proposed edit.
    """
    written = file_ops.write_accept(scope_name, rel_path, content)
    broken = check_wikilinks(content, scope_name)
    result: dict = {"written": str(written), "broken_links": broken}
    if broken:
        result["warning"] = f"Broken wikilinks detected: {', '.join(broken)}"
    return result


def propose_page_update(
    scope_name: str,
    rel_path: str,
    section_header: str,
    new_section_content: str,
    explanation: str = "Update Obsidian page section",
) -> dict:
    """
    Replace a named section in an existing page.
    If section_header is empty, replaces the entire body.
    """
    page = get_page(scope_name, rel_path)
    if page is None:
        raise FileNotFoundError(f"Page not found: {rel_path}")

    if not section_header:
        fm_text = _build_frontmatter(page["frontmatter"])
        new_content = fm_text + new_section_content
    else:
        # Find the section by heading and replace up to the next same-or-higher heading
        pattern = re.compile(
            r"(#{1,6})\s+" + re.escape(section_header) + r"\s*\n",
            re.IGNORECASE,
        )
        m = pattern.search(page["content"])
        if m is None:
            raise ValueError(f"Section not found: {section_header!r}")
        level = len(m.group(1))
        # Find where this section ends (next heading of same/higher level)
        end_pattern = re.compile(r"^#{1," + str(level) + r"}\s", re.MULTILINE)
        end_m = end_pattern.search(page["content"], m.end())
        if end_m:
            new_content = (
                page["content"][: m.start()]
                + m.group(0)
                + new_section_content.rstrip("\n") + "\n"
                + page["content"][end_m.start():]
            )
        else:
            new_content = (
                page["content"][: m.start()]
                + m.group(0)
                + new_section_content.rstrip("\n") + "\n"
            )

    written = file_ops.write_accept(scope_name, rel_path, new_content)
    broken = check_wikilinks(new_content, scope_name)
    result: dict = {"written": str(written), "broken_links": broken}
    if broken:
        result["warning"] = f"Broken wikilinks detected: {', '.join(broken)}"
    return result
