"""
Obsidian maintenance job — runs Monday 7am.

Scans the Obsidian vault for broken wikilinks and orphaned notes, then
pushes checklist items and a summary notification for any issues found.
"""
from __future__ import annotations

import logging
import re

import checklist
import config
import notifications
import obsidian_ops

log = logging.getLogger("shrimp.automations.obsidian_maintenance")


def _find_obsidian_scope() -> str | None:
    """Find the obsidian scope name from WATCHED_DIRS."""
    for s in config.WATCHED_DIRS:
        name: str = s.get("name", "")
        path: str = s.get("path", "")
        if name.lower() == "obsidian":
            return name
        if "obsidian" in name.lower() or "obsidian" in path.lower():
            return name
    return None


def _extract_wikilink_targets(content: str) -> set[str]:
    """Return all wikilink targets (lowercased) found in the content."""
    pattern = re.compile(r"\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]")
    return {m.group(1).strip().lower() for m in pattern.finditer(content)}


def run() -> None:
    """Entry point called by the scheduler (sync)."""
    try:
        scope_name = _find_obsidian_scope()
        if scope_name is None:
            log.info("Obsidian maintenance: no obsidian scope found, skipping")
            return

        log.info("Obsidian maintenance: scanning vault in scope '%s'", scope_name)

        pages = obsidian_ops.list_vault_pages(scope_name)
        if not pages:
            log.info("Obsidian maintenance: no pages found in scope '%s'", scope_name)
            return

        log.info("Obsidian maintenance: found %d pages", len(pages))

        # Build lookup of all page titles (stem, lowercased) for orphan detection
        all_titles: set[str] = set()
        for page in pages:
            # Use the stem from the path as the canonical title key
            from pathlib import Path as _Path
            stem = _Path(page["path"]).stem.lower()
            all_titles.add(stem)

        broken_count = 0
        orphan_count = 0

        # Track which pages are linked to (by wikilink target, lowercased)
        linked_titles: set[str] = set()

        # We need page content for both broken link detection and orphan detection.
        # list_vault_pages doesn't return content, so we use get_page for each.
        # Build a two-pass approach:
        # Pass 1: collect all wikilink targets across the vault
        page_contents: dict[str, str] = {}
        for page in pages:
            full_page = obsidian_ops.get_page(scope_name, page["path"])
            if full_page is None:
                continue
            content = full_page.get("content") or full_page.get("body", "")
            page_contents[page["path"]] = content
            targets = _extract_wikilink_targets(content)
            linked_titles.update(targets)

        # Pass 2: check broken links and orphans
        index_names = {"index", "home", "readme", "start", "moc", "dashboard"}

        for page in pages:
            from pathlib import Path as _Path
            stem = _Path(page["path"]).stem
            stem_lower = stem.lower()
            content = page_contents.get(page["path"], "")

            # Broken link check
            broken_links = obsidian_ops.check_wikilinks(content, scope_name)
            for broken in broken_links:
                checklist.append_item(
                    text=f"Fix broken link: [[{broken}]] in {stem}",
                    source="obsidian_maintenance",
                    source_ref=f"broken:{page['path']}:{broken}",
                    priority="low",
                )
                broken_count += 1

            # Orphan check: page not referenced by any other page AND not a known index
            if stem_lower not in linked_titles and stem_lower not in index_names:
                checklist.append_item(
                    text=f"Review orphaned note: {stem}",
                    source="obsidian_maintenance",
                    source_ref=f"orphan:{page['path']}",
                    priority="low",
                )
                orphan_count += 1

        log.info(
            "Obsidian maintenance: %d broken links, %d orphaned notes",
            broken_count,
            orphan_count,
        )

        if broken_count > 0 or orphan_count > 0:
            notifications.append(
                title="Obsidian Maintenance",
                body=f"Found {broken_count} broken link{'s' if broken_count != 1 else ''}, {orphan_count} orphaned note{'s' if orphan_count != 1 else ''}",
                type="obsidian_maintenance",
                priority="low",
                source="obsidian_maintenance",
            )

        log.info("Obsidian maintenance complete")
    except Exception:
        log.exception("Obsidian maintenance job failed")
