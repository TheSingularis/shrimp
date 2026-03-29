"""Conversation persistence and management."""
from pathlib import Path
from datetime import datetime
import json
import uuid
import logging
from typing import Optional

log = logging.getLogger("shrimp.conversations")

CONVERSATIONS_DIR = Path(__file__).parent.parent / "conversations"
CONVERSATIONS_DIR.mkdir(exist_ok=True)


class Conversation:
    """Represents a saved conversation."""

    def __init__(
        self,
        conversation_id: Optional[str] = None,
        title: Optional[str] = None,
        messages: Optional[list] = None,
        created_at: Optional[str] = None,
        updated_at: Optional[str] = None,
        active_scopes: Optional[list] = None,
        project_id: Optional[str] = None,
    ):
        self.conversation_id = conversation_id or str(uuid.uuid4())
        self.title = title or "New Conversation"
        self.messages = messages or []
        self.created_at = created_at or datetime.utcnow().isoformat() + "Z"
        self.updated_at = updated_at or datetime.utcnow().isoformat() + "Z"
        self.active_scopes = active_scopes or []
        self.project_id = project_id

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "conversation_id": self.conversation_id,
            "title": self.title,
            "messages": self.messages,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "active_scopes": self.active_scopes,
            "project_id": self.project_id,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Conversation":
        """Create Conversation from dictionary."""
        return cls(
            conversation_id=data.get("conversation_id"),
            title=data.get("title"),
            messages=data.get("messages", []),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
            active_scopes=data.get("active_scopes", []),
            project_id=data.get("project_id"),
        )

    def save(self) -> None:
        """Save conversation to disk."""
        self.updated_at = datetime.utcnow().isoformat() + "Z"
        file_path = CONVERSATIONS_DIR / f"{self.conversation_id}.json"
        with open(file_path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)
        log.info("Saved conversation %s: %s", self.conversation_id, self.title)

    @classmethod
    def load(cls, conversation_id: str) -> "Conversation":
        """Load conversation from disk."""
        file_path = CONVERSATIONS_DIR / f"{conversation_id}.json"
        if not file_path.exists():
            raise FileNotFoundError(f"Conversation {conversation_id} not found")

        with open(file_path, "r") as f:
            data = json.load(f)

        log.info("Loaded conversation %s", conversation_id)
        return cls.from_dict(data)

    @classmethod
    def list_all(cls) -> list[dict]:
        """List all conversations (metadata only, sorted by updated_at)."""
        conversations = []

        for file_path in CONVERSATIONS_DIR.glob("*.json"):
            try:
                with open(file_path, "r") as f:
                    data = json.load(f)

                # Return metadata only (no messages)
                conversations.append({
                    "conversation_id": data["conversation_id"],
                    "title": data["title"],
                    "created_at": data["created_at"],
                    "updated_at": data["updated_at"],
                    "message_count": len(data.get("messages", [])),
                    "project_id": data.get("project_id"),
                })
            except Exception as e:
                log.error("Failed to load conversation %s: %s", file_path, e)

        # Sort by updated_at descending (newest first)
        conversations.sort(key=lambda c: c["updated_at"], reverse=True)
        return conversations

    @classmethod
    def delete(cls, conversation_id: str) -> None:
        """Delete conversation from disk."""
        file_path = CONVERSATIONS_DIR / f"{conversation_id}.json"
        if file_path.exists():
            file_path.unlink()
            log.info("Deleted conversation %s", conversation_id)
        else:
            raise FileNotFoundError(f"Conversation {conversation_id} not found")


def generate_title_from_message(message: str) -> str:
    """Generate a conversation title from the first user message."""
    # Simple version: use first 60 chars
    title = message.strip()[:60]
    if len(message) > 60:
        title += "..."
    return title or "New Conversation"
