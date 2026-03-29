"""
Tool executor for Ollama function calling.

Implements the 4 core tools:
1. read_file - Read full file content from a scope
2. search_files - Semantic search across scopes
3. list_scope - Get file tree for a scope
4. propose_file_edit - Propose a file change (accumulates for sentinel emission)

Security:
- All file paths validated against scope roots
- No direct file writes (edits accumulate for user review)
- Rate limiting to prevent abuse
"""

import logging
from pathlib import Path
from typing import Any
import json

import config
import rag
import file_ops

log = logging.getLogger("shrimp.tool_executor")


class ToolExecutor:
    """
    Executes tools called by the LLM during agentic loops.

    Maintains state for:
    - Accumulated file edits (for sentinel emission)
    - Tool call count (for rate limiting)
    """

    def __init__(self):
        self.proposed_edits: list[dict] = []
        self.tool_call_count = 0
        self.max_tool_calls = 50  # Prevent infinite loops

    def execute(self, tool_name: str, arguments: dict[str, Any]) -> str:
        """
        Execute a tool and return the result as a string.

        Args:
            tool_name: Name of the tool to execute
            arguments: Tool arguments from LLM

        Returns:
            Result string to send back to LLM

        Raises:
            ValueError: If tool name is invalid or rate limit exceeded
            FileNotFoundError: If requested file/scope doesn't exist
            PermissionError: If path validation fails
        """
        self.tool_call_count += 1

        if self.tool_call_count > self.max_tool_calls:
            raise ValueError(f"Tool call limit exceeded ({self.max_tool_calls})")

        log.info(f"Executing tool: {tool_name} (call #{self.tool_call_count})")

        # Dispatch to tool implementation
        match tool_name:
            case "read_file":
                return self._read_file(**arguments)
            case "search_files":
                return self._search_files(**arguments)
            case "list_scope":
                return self._list_scope(**arguments)
            case "propose_file_edit":
                return self._propose_file_edit(**arguments)
            case _:
                raise ValueError(f"Unknown tool: {tool_name}")

    def _read_file(self, scope: str, path: str) -> str:
        """
        Read full file content from a scope.

        Args:
            scope: Scope name (e.g., "shrimp", "obsidian")
            path: Relative path within scope

        Returns:
            File content as string
        """
        try:
            content = rag.read_file_from_scope(scope, path)
            log.info(f"read_file: {scope}/{path} ({len(content)} chars)")
            return f"File: {scope}/{path}\n\n{content}"
        except FileNotFoundError as e:
            log.warning(f"read_file failed: {e}")
            return f"Error: File not found - {scope}/{path}"
        except PermissionError as e:
            log.warning(f"read_file permission denied: {e}")
            return f"Error: Permission denied - {scope}/{path}"
        except Exception as e:
            log.exception(f"read_file unexpected error: {e}")
            return f"Error: Failed to read file - {str(e)}"

    def _search_files(
        self,
        query: str,
        scopes: list[str],
        top_k: int = 5
    ) -> str:
        """
        Semantic search across indexed scopes.

        Args:
            query: Search query
            scopes: List of scope names to search
            top_k: Number of results to return (not currently used - fixed at 5 in rag.py)

        Returns:
            Combined context from all scopes
        """
        try:
            # Validate scopes exist
            valid_scopes = [s["name"] for s in config.WATCHED_DIRS if s.get("enabled")]
            invalid = [s for s in scopes if s not in valid_scopes]
            if invalid:
                return f"Error: Invalid scopes: {', '.join(invalid)}"

            context = rag.query_scopes(query, scopes)
            log.info(f"search_files: query='{query[:50]}' scopes={scopes} ({len(context)} chars)")

            if not context or context.strip() == "":
                return f"No relevant content found for query: {query}"

            return context
        except Exception as e:
            log.exception(f"search_files unexpected error: {e}")
            return f"Error: Search failed - {str(e)}"

    def _list_scope(self, scope: str, max_files: int = 150) -> str:
        """
        Get file tree for a scope.

        Args:
            scope: Scope name
            max_files: Maximum files to list (default 150)

        Returns:
            File tree as string
        """
        try:
            # Validate scope exists
            if scope not in [s["name"] for s in config.WATCHED_DIRS]:
                return f"Error: Scope '{scope}' does not exist"

            # Get structural summary
            summary = rag.get_structural_summary([scope], max_files=max_files)
            log.info(f"list_scope: {scope} (max_files={max_files})")

            if not summary or summary.strip() == "":
                return f"Scope '{scope}' has no structural map yet - needs indexing"

            return summary
        except Exception as e:
            log.exception(f"list_scope unexpected error: {e}")
            return f"Error: Failed to list scope - {str(e)}"

    def _propose_file_edit(
        self,
        scope: str,
        path: str,
        new_content: str,
        explanation: str
    ) -> str:
        """
        Propose a file edit or create a new file (accumulates for sentinel emission).

        Does NOT write the file directly - stores the edit for user review.
        Works for both existing files (edit) and new files (create).

        Args:
            scope: Scope name
            path: Relative path within scope (e.g., 'TODO.md' for root, 'docs/guide.md' for nested)
            new_content: New file content
            explanation: Why this edit/creation is being made

        Returns:
            Confirmation message
        """
        try:
            # Validate scope exists
            scope_obj = next(
                (s for s in config.WATCHED_DIRS if s["name"] == scope), None
            )
            if not scope_obj:
                return f"Error: Scope '{scope}' does not exist"

            # Validate path doesn't escape scope root
            root = Path(scope_obj["path"]).expanduser().resolve()
            target = (root / path).resolve()

            if not str(target).startswith(str(root)):
                log.warning(f"propose_file_edit: path escape attempt - {scope}/{path}")
                return f"Error: Path '{path}' escapes scope root"

            # Accumulate edit
            self.proposed_edits.append({
                "scope": scope,
                "path": path,
                "new_content": new_content,
                "explanation": explanation
            })

            log.info(f"propose_file_edit: {scope}/{path} ({len(new_content)} chars) - {explanation[:50]}")

            return f"Edit proposed for {scope}/{path}. {explanation}"
        except Exception as e:
            log.exception(f"propose_file_edit unexpected error: {e}")
            return f"Error: Failed to propose edit - {str(e)}"

    def get_proposed_edits(self) -> list[dict]:
        """Return all accumulated proposed edits."""
        return self.proposed_edits

    def has_proposed_edits(self) -> bool:
        """Check if any edits have been proposed."""
        return len(self.proposed_edits) > 0


def build_tool_definitions() -> list[dict]:
    """
    Build Ollama tool definitions for the 4 core tools.

    Returns:
        List of tool definition dicts in Ollama format
    """
    return [
        {
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read the full content of a file from a scope. Use this when you need to see the complete file contents before making edits or answering questions about specific code.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "scope": {
                            "type": "string",
                            "description": "The scope name (e.g., 'shrimp', 'obsidian')"
                        },
                        "path": {
                            "type": "string",
                            "description": "Relative path to the file within the scope"
                        }
                    },
                    "required": ["scope", "path"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "search_files",
                "description": "Perform semantic search across indexed scopes to find relevant code or documentation. Use this when you need to find information but don't know which specific files to read.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query"
                        },
                        "scopes": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "List of scope names to search"
                        },
                        "top_k": {
                            "type": "integer",
                            "description": "Number of results to return (default 5)",
                            "default": 5
                        }
                    },
                    "required": ["query", "scopes"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "list_scope",
                "description": "List all files in a scope's file tree. Use this to explore what files are available in a scope before reading specific files.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "scope": {
                            "type": "string",
                            "description": "The scope name to list"
                        },
                        "max_files": {
                            "type": "integer",
                            "description": "Maximum number of files to list (default 150)",
                            "default": 150
                        }
                    },
                    "required": ["scope"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "propose_file_edit",
                "description": "Propose an edit to an existing file OR create a new file. The change will be reviewed by the user before being applied. For new files, use a relative path within the scope (e.g., 'TODO.md' for root level, 'docs/guide.md' for nested). Always explain why you're making this change.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "scope": {
                            "type": "string",
                            "description": "The scope name"
                        },
                        "path": {
                            "type": "string",
                            "description": "Relative path to the file within the scope"
                        },
                        "new_content": {
                            "type": "string",
                            "description": "The complete new content for the file"
                        },
                        "explanation": {
                            "type": "string",
                            "description": "Explanation of why this edit is being made"
                        }
                    },
                    "required": ["scope", "path", "new_content", "explanation"]
                }
            }
        }
    ]
