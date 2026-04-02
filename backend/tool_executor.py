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

    def _read_file(
        self,
        scope: str,
        path: str,
        start_line: int | None = None,
        end_line: int | None = None
    ) -> str:
        """
        Read file content from a scope, optionally limiting to a line range.
        Validates path exists and provides suggestions on error.

        Args:
            scope: Scope name (e.g., "shrimp", "obsidian")
            path: Relative path within scope
            start_line: Optional starting line number (1-indexed, inclusive)
            end_line: Optional ending line number (1-indexed, inclusive)

        Returns:
            File content as string or helpful error with suggestions
        """
        # Validate scope
        scope_obj = next((s for s in config.WATCHED_DIRS if s["name"] == scope), None)
        if not scope_obj:
            valid_scopes = [s["name"] for s in config.WATCHED_DIRS]
            return f"Error: Scope '{scope}' does not exist. Valid scopes: {valid_scopes}"

        # Check if path exists in structural map
        files = rag.structural_maps.get(scope, [])
        file_paths = [f["path"] for f in files]

        if path not in file_paths:
            # Provide helpful suggestions
            from difflib import get_close_matches
            suggestions = get_close_matches(path, file_paths, n=3, cutoff=0.6)

            error_msg = f"Error: File not found in scope '{scope}': {path}"

            if suggestions:
                error_msg += f"\n\nDid you mean one of these?\n"
                for s in suggestions:
                    error_msg += f"  • {s}\n"
            else:
                # Show files in same directory
                dir_name = "/".join(path.split("/")[:-1])
                if dir_name:
                    similar = [p for p in file_paths if p.startswith(dir_name + "/")][:5]
                    if similar:
                        error_msg += f"\n\nFiles in {dir_name}/:\n"
                        for s in similar:
                            error_msg += f"  • {s}\n"

            error_msg += f"\n💡 Tip: Use list_scope('{scope}') to see all available files."
            log.warning(f"read_file path validation failed: {scope}/{path}")
            return error_msg

        # Read file with optional line range
        try:
            content = rag.read_file_from_scope(scope, path, start_line, end_line)

            # Format response based on whether line range was used
            if start_line is not None or end_line is not None:
                # Line-numbered output - wrap in code fence for better display
                range_str = f"lines {start_line or 1}-{end_line or '(end)'}"
                # Detect language from file extension
                ext = path.split('.')[-1] if '.' in path else ''
                lang_map = {
                    'py': 'python', 'js': 'javascript', 'ts': 'typescript',
                    'tsx': 'typescript', 'jsx': 'javascript', 'java': 'java',
                    'cpp': 'cpp', 'c': 'c', 'go': 'go', 'rs': 'rust',
                    'rb': 'ruby', 'php': 'php', 'css': 'css', 'html': 'html',
                    'md': 'markdown', 'json': 'json', 'yaml': 'yaml', 'yml': 'yaml',
                    'sh': 'bash', 'bash': 'bash', 'sql': 'sql'
                }
                lang = lang_map.get(ext, '')
                log.info(f"read_file: {scope}/{path} ({range_str})")
                return f"File: {scope}/{path} ({range_str})\n\n```{lang}\n{content}\n```"
            else:
                log.info(f"read_file: {scope}/{path} ({len(content)} chars)")
                return f"File: {scope}/{path}\n\n{content}"
        except ValueError as e:
            # Line range validation error
            log.warning(f"read_file line range error: {e}")
            return f"Error: {str(e)}"
        except FileNotFoundError as e:
            log.warning(f"read_file failed: {e}")
            return f"Error: File not found on disk: {scope}/{path}"
        except PermissionError as e:
            log.warning(f"read_file permission denied: {e}")
            return f"Error: Permission denied: {scope}/{path}"
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
        explanation: str,
        start_line: int | None = None,
        end_line: int | None = None
    ) -> str:
        """
        Propose a file edit or create a new file (accumulates for sentinel emission).

        Does NOT write the file directly - stores the edit for user review.
        Works for both existing files (edit) and new files (create).

        Supports line-based editing: if start_line/end_line are provided, only replaces
        that section of the file, preserving the rest.

        Args:
            scope: Scope name
            path: Relative path within scope (e.g., 'TODO.md' for root, 'docs/guide.md' for nested)
            new_content: New content (full file OR just the lines being replaced if start_line/end_line provided)
            explanation: Why this edit/creation is being made
            start_line: Optional starting line for partial edit (1-indexed, inclusive)
            end_line: Optional ending line for partial edit (1-indexed, inclusive)

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

            # Handle line-based editing
            final_content = new_content
            if start_line is not None and end_line is not None:
                # Explicit line-based edit with start/end parameters
                try:
                    original = rag.read_file_from_scope(scope, path)
                    original_lines = original.splitlines(keepends=True)

                    # Convert to 0-indexed
                    start_idx = start_line - 1
                    end_idx = end_line  # end_line is inclusive, so this is correct for slicing

                    # Ensure new_content ends with newline if original did
                    new_content_lines = new_content.splitlines(keepends=True)
                    if not new_content_lines:
                        new_content_lines = ['']
                    elif original_lines and not new_content.endswith('\n') and original_lines[-1].endswith('\n'):
                        new_content_lines[-1] += '\n'

                    # Splice: before + new + after
                    final_lines = (
                        original_lines[:start_idx] +
                        new_content_lines +
                        original_lines[end_idx:]
                    )
                    final_content = ''.join(final_lines)

                    log.info(f"propose_file_edit: line-based edit {scope}/{path} lines {start_line}-{end_line}")
                except FileNotFoundError:
                    # File doesn't exist - treat as full file creation
                    final_content = new_content
                    log.info(f"propose_file_edit: new file {scope}/{path} (original not found for line-based edit)")
            else:
                # No explicit line range - check if this looks like a partial edit
                # Simple heuristic: if new_content is much shorter, assume it's editing the first N lines
                try:
                    original = rag.read_file_from_scope(scope, path)
                    original_lines = original.splitlines(keepends=True)
                    new_content_lines = new_content.splitlines(keepends=True)

                    # Detect if new_content is suspiciously short (likely partial edit)
                    if len(new_content_lines) < len(original_lines) * 0.5:  # New content is less than 50% of original
                        # Simple assumption: model is editing the first N lines
                        # Replace first N lines with new content, preserve the rest
                        # where N is the number of lines in new content (accounting for added lines like comments)

                        # Heuristic: if new content starts with similar imports/structure as original,
                        # it's likely editing from the beginning
                        looks_like_start = False

                        # Check if first few lines of new content match structure of original start
                        check_lines = min(3, len(new_content_lines), len(original_lines))
                        similar_count = 0
                        for i in range(check_lines):
                            new_stripped = new_content_lines[i].strip()
                            orig_stripped = original_lines[i].strip() if i < len(original_lines) else ""

                            # Comment/import structure match
                            if ((new_stripped.startswith(('from ', 'import ', '//', '#', '/*')) and
                                 orig_stripped.startswith(('from ', 'import ', '//', '#', '/*'))) or
                                new_stripped == orig_stripped):
                                similar_count += 1

                        looks_like_start = (similar_count >= check_lines * 0.5)

                        if looks_like_start:
                            # Auto-preserve: find where new content ends in the original file
                            # by matching the last few lines of new content to original lines

                            # Strategy: scan through original file to find where the new content's
                            # last line appears. This tells us how many original lines were edited.

                            # Find the last non-empty line in new content to use as anchor
                            last_new_line = None
                            last_new_idx = -1
                            for i in range(len(new_content_lines) - 1, -1, -1):
                                if new_content_lines[i].strip():
                                    last_new_line = new_content_lines[i].strip()
                                    last_new_idx = i
                                    break

                            if last_new_line:
                                # Find this line in the original file
                                original_match_idx = -1
                                for i, orig_line in enumerate(original_lines):
                                    if orig_line.strip() == last_new_line:
                                        # Verify this is the right match by checking a few lines around it
                                        # Look backward from this line in both new and original
                                        is_match = True
                                        check_back = min(2, last_new_idx, i)
                                        for j in range(1, check_back + 1):
                                            if (new_content_lines[last_new_idx - j].strip() !=
                                                original_lines[i - j].strip()):
                                                is_match = False
                                                break

                                        if is_match:
                                            original_match_idx = i
                                            break

                                if original_match_idx >= 0:
                                    # Found where the new content corresponds to in original
                                    # Replace original lines [0:original_match_idx+1] with new content
                                    # Preserve everything after original_match_idx+1
                                    splice_point = original_match_idx + 1
                                    final_lines = new_content_lines + original_lines[splice_point:]
                                    final_content = ''.join(final_lines)

                                    log.warning(
                                        f"propose_file_edit: AUTO-PRESERVED rest of file for {scope}/{path} "
                                        f"(new: {len(new_content_lines)} lines, original: {len(original_lines)} lines). "
                                        f"Detected edit of first {splice_point} lines by matching content. "
                                        f"Model should use start_line=1/end_line={splice_point} parameters!"
                                    )
                                else:
                                    # Couldn't find match - fall back to length-based
                                    final_lines = new_content_lines + original_lines[len(new_content_lines):]
                                    final_content = ''.join(final_lines)
                                    log.warning(
                                        f"propose_file_edit: AUTO-PRESERVED (fallback) for {scope}/{path} "
                                        f"using length-based splice at line {len(new_content_lines)}"
                                    )
                            else:
                                # All new lines are empty? Just use as-is
                                log.warning(f"propose_file_edit: No anchor line found in new content for {scope}/{path}")
                        else:
                            # Doesn't look like editing from the start - use new_content as-is
                            log.info(f"propose_file_edit: full file replacement {scope}/{path} (doesn't look like partial edit from start)")
                    else:
                        # New content is similar length to original - likely intentional full replacement
                        log.info(f"propose_file_edit: full file replacement {scope}/{path}")
                except FileNotFoundError:
                    # File doesn't exist - this is file creation
                    log.info(f"propose_file_edit: new file creation {scope}/{path}")

            # Accumulate edit
            self.proposed_edits.append({
                "scope": scope,
                "path": path,
                "new_content": final_content,
                "explanation": explanation
            })

            log.info(f"propose_file_edit: {scope}/{path} ({len(final_content)} chars) - {explanation[:50]}")

            if start_line and end_line:
                return f"Edit proposed for {scope}/{path} (lines {start_line}-{end_line}). {explanation}"
            else:
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
                "description": "Read file content from a scope. Optionally specify line range to read only specific lines. When user mentions a line number (e.g., 'around line 698'), use start_line and end_line to read that section (e.g., start_line=668, end_line=728 to read 60 lines centered on 698).",
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
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "Optional starting line number (1-indexed, inclusive). Use this when you only need to read a specific section of the file."
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "Optional ending line number (1-indexed, inclusive). Use this when you only need to read a specific section of the file."
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
                "description": "Propose an edit to an existing file OR create a new file. Supports both full-file replacement and line-based editing. For line-based edits, specify start_line and end_line, and provide only the new content for that section. The tool will automatically preserve the rest of the file.",
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
                            "description": "For full-file edits: complete new file content. For line-based edits: only the new content for the specified line range."
                        },
                        "explanation": {
                            "type": "string",
                            "description": "Explanation of why this edit is being made"
                        },
                        "start_line": {
                            "type": "integer",
                            "description": "Optional: Starting line number for line-based edit (1-indexed, inclusive). If provided, end_line must also be provided."
                        },
                        "end_line": {
                            "type": "integer",
                            "description": "Optional: Ending line number for line-based edit (1-indexed, inclusive). If provided, start_line must also be provided."
                        }
                    },
                    "required": ["scope", "path", "new_content", "explanation"]
                }
            }
        }
    ]
