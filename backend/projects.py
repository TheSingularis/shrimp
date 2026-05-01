"""Project management for organizing conversations."""
from pathlib import Path
import json
import uuid
from datetime import datetime, timezone
import logging
from config_utils import get_data_dir

log = logging.getLogger("shrimp.projects")

PROJECTS_FILE = get_data_dir() / "conversations" / "projects.json"


class Project:
    """Represents a project for organizing conversations."""

    def __init__(
        self,
        project_id: str,
        name: str,
        description: str,
        color: str,
        settings: dict,
        created_at: str,
        updated_at: str
    ):
        self.project_id = project_id
        self.name = name
        self.description = description
        self.color = color
        self.settings = settings
        self.created_at = created_at
        self.updated_at = updated_at

    @classmethod
    def load_all(cls) -> dict:
        """Load all projects from projects.json"""
        if not PROJECTS_FILE.exists():
            return {"projects": [], "default_project_id": None}

        with open(PROJECTS_FILE, "r") as f:
            return json.load(f)

    @classmethod
    def save_all(cls, data: dict):
        """Save all projects to projects.json"""
        with open(PROJECTS_FILE, "w") as f:
            json.dump(data, f, indent=2)

    @classmethod
    def create(cls, name: str, description: str = "", color: str = "#3b82f6", settings: dict = None):
        """Create a new project"""
        data = cls.load_all()

        project = {
            "project_id": str(uuid.uuid4()),
            "name": name,
            "description": description,
            "color": color,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "settings": settings or {"default_scopes": [], "custom_instructions": ""}
        }

        data["projects"].append(project)
        cls.save_all(data)

        log.info("Created project: %s (%s)", name, project["project_id"])
        return project

    @classmethod
    def update(cls, project_id: str, **updates):
        """Update an existing project"""
        data = cls.load_all()

        project = None
        for p in data["projects"]:
            if p["project_id"] == project_id:
                p.update(updates)
                p["updated_at"] = datetime.now(timezone.utc).isoformat()
                project = p
                break

        if not project:
            raise ValueError(f"Project {project_id} not found")

        cls.save_all(data)
        log.info("Updated project: %s", project_id)
        return project

    @classmethod
    def delete(cls, project_id: str):
        """Delete a project"""
        data = cls.load_all()
        original_count = len(data["projects"])
        data["projects"] = [p for p in data["projects"] if p["project_id"] != project_id]

        if len(data["projects"]) == original_count:
            raise ValueError(f"Project {project_id} not found")

        cls.save_all(data)
        log.info("Deleted project: %s", project_id)


def migrate_to_projects():
    """Run on startup if projects.json doesn't exist"""
    if PROJECTS_FILE.exists():
        return

    log.info("Migrating conversations to project structure...")

    # Create default projects.json
    Project.save_all({"projects": [], "default_project_id": None})

    # Add project_id: null to existing conversations
    conv_dir = get_data_dir() / "conversations"
    if conv_dir.exists():
        for conv_file in conv_dir.glob("*.json"):
            try:
                with open(conv_file, "r") as f:
                    data = json.load(f)

                if "project_id" not in data:
                    data["project_id"] = None
                    with open(conv_file, "w") as f:
                        json.dump(data, f, indent=2)
            except Exception as e:
                log.error(f"Failed to migrate {conv_file}: {e}")

    log.info("Migration complete")
