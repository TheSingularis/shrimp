"""Daily Focus Checklist — persistent task list with multi-source aggregation."""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone, date
from pathlib import Path
from config_utils import get_data_dir

log = logging.getLogger("shrimp.checklist")

_CHECKLIST_PATH = get_data_dir() / "notifications" / "checklist.jsonl"
_CHECKLIST_PATH.parent.mkdir(parents=True, exist_ok=True)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return date.today().isoformat()


def _read_all() -> list[dict]:
    """Read all items from checklist file."""
    if not _CHECKLIST_PATH.exists():
        return []
    items: list[dict] = []
    try:
        with _CHECKLIST_PATH.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    items.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    except Exception:
        log.exception("Failed to read checklist")
    return items


def _write_all(items: list[dict]) -> None:
    """Rewrite the entire checklist file."""
    try:
        with _CHECKLIST_PATH.open("w") as f:
            for item in items:
                f.write(json.dumps(item) + "\n")
    except Exception:
        log.exception("Failed to write checklist")


def _find_duplicate(items: list[dict], source: str, source_ref: str | None) -> dict | None:
    """Find existing item with same source+source_ref for deduplication."""
    if not source_ref:
        return None
    for item in items:
        if item.get("source") == source and item.get("source_ref") == source_ref:
            return item
    return None


def append_item(
    text: str,
    source: str = "manual",
    source_ref: str | None = None,
    priority: str = "normal",
    due_date: str | None = None,
    context: dict | None = None,
) -> dict:
    """
    Create and persist a checklist item.
    Deduplicates by source+source_ref — returns existing item if found.
    """
    items = _read_all()

    # Check for duplicate
    existing = _find_duplicate(items, source, source_ref)
    if existing:
        log.debug("Skipping duplicate checklist item: %s", source_ref)
        return existing

    item = {
        "id": str(uuid.uuid4()),
        "text": text,
        "completed": False,
        "completed_at": None,
        "created_at": _now(),
        "due_date": due_date or _today(),
        "source": source,
        "source_ref": source_ref,
        "priority": priority,
        "context": context or {},
    }

    try:
        with _CHECKLIST_PATH.open("a") as f:
            f.write(json.dumps(item) + "\n")
    except Exception:
        log.exception("Failed to append checklist item")

    return item


def list_items(
    due_date: str | None = None,
    include_completed: bool = False,
) -> list[dict]:
    """
    Return checklist items sorted by priority then created_at.
    If due_date is None, returns today's items + all overdue incomplete items.
    """
    items = _read_all()
    today = _today()
    target_date = due_date or today

    result: list[dict] = []
    for item in items:
        # Archived stubs exist only for dedup — never shown in the UI
        if item.get("archived"):
            continue

        item_date = item.get("due_date", today)
        is_completed = item.get("completed", False)

        # Filter by completion status
        if is_completed and not include_completed:
            continue

        # Include if:
        # 1. Item is due on target date, OR
        # 2. Item is overdue (due before today) and incomplete
        if item_date == target_date:
            result.append(item)
        elif item_date < today and not is_completed and due_date is None:
            # Mark as rolled over for UI
            item["rolled_over"] = True
            result.append(item)

    # Sort by priority (urgent > high > normal > low) then by created_at
    priority_order = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
    result.sort(key=lambda x: (
        priority_order.get(x.get("priority", "normal"), 2),
        x.get("created_at", ""),
    ))

    return result


def toggle_item(item_id: str, completed: bool) -> dict | None:
    """Mark item completed/incomplete. Returns updated item or None if not found."""
    items = _read_all()
    found = None

    for item in items:
        if item.get("id") == item_id:
            item["completed"] = completed
            item["completed_at"] = _now() if completed else None
            found = item
            break

    if found:
        _write_all(items)

    return found


def delete_item(item_id: str) -> bool:
    """Delete an item. Returns True if found."""
    items = _read_all()
    original_len = len(items)
    items = [item for item in items if item.get("id") != item_id]

    if len(items) < original_len:
        _write_all(items)
        return True
    return False


def clear_completed(before_date: str | None = None) -> int:
    """
    Clear completed items. Returns count cleared.
    Automation items (source != manual, has source_ref) are reduced to a
    minimal archived stub so the same task cannot be re-added by the next
    automation run. Manual items are fully deleted.
    """
    items = _read_all()
    count = 0
    result: list[dict] = []

    for item in items:
        # Existing archived stubs are always kept as-is
        if item.get("archived"):
            result.append(item)
            continue

        if not item.get("completed"):
            result.append(item)
            continue

        # Apply optional date filter — keep if due_date is on/after cutoff
        if before_date and item.get("due_date", "") >= before_date:
            result.append(item)
            continue

        count += 1
        # Automation items: shrink to a dedup stub
        if item.get("source", "manual") != "manual" and item.get("source_ref"):
            result.append({
                "id": item["id"],
                "source": item["source"],
                "source_ref": item["source_ref"],
                "completed": True,
                "archived": True,
                "text": "",
            })
        # Manual items: fully removed (nothing appended to result)

    if count > 0:
        _write_all(result)

    return count


def rollover_items() -> int:
    """
    Update due_date of overdue incomplete items to today.
    Returns count of items rolled over.
    """
    items = _read_all()
    today = _today()
    count = 0

    for item in items:
        item_date = item.get("due_date", today)
        if item_date < today and not item.get("completed"):
            item["due_date"] = today
            if "rolled_from" not in item.get("context", {}):
                if "context" not in item:
                    item["context"] = {}
                item["context"]["rolled_from"] = item_date
            count += 1

    if count > 0:
        _write_all(items)
        log.info("Rolled over %d checklist items to today", count)

    return count


def get_item(item_id: str) -> dict | None:
    """Get a single item by ID."""
    items = _read_all()
    for item in items:
        if item.get("id") == item_id:
            return item
    return None


def update_item(item_id: str, **fields) -> dict | None:
    """Update arbitrary fields on an item. Returns updated item or None if not found."""
    items = _read_all()
    found = None
    for item in items:
        if item.get("id") == item_id:
            item.update(fields)
            found = item
            break
    if found:
        _write_all(items)
    return found


def list_untriaged() -> list[dict]:
    """Return today's incomplete items that haven't been AI-triaged yet."""
    today = _today()
    result = []
    for item in _read_all():
        if item.get("archived") or item.get("completed") or item.get("triage_done"):
            continue
        item_date = item.get("due_date", today)
        if item_date <= today:
            result.append(item)
    return result
