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
import obsidian_ops

log = logging.getLogger("shrimp.tool_executor")


# ── Web helpers ────────────────────────────────────────────────────────────────

def _parse_ddg_lite(html: str, max_results: int) -> list[dict]:
    """Parse search result title/url/snippet triples from DuckDuckGo lite HTML.

    DDG lite structure (per actual HTML inspection):
      <td><a class='result-link' href='//duckduckgo.com/l/?uddg=<encoded-url>&...'>Title</a></td>
      <td class='result-snippet'>Snippet text...</td>
    The link anchor has class 'result-link' but the parent <td> has no class.
    URLs are DDG redirect links; the real URL is in the 'uddg' query param.
    """
    import urllib.parse
    from html.parser import HTMLParser

    def _decode_ddg_url(href: str) -> str:
        """Extract the real URL from a DDG redirect href."""
        if not href:
            return ""
        # Make it a full URL so urlparse works
        if href.startswith("//"):
            href = "https:" + href
        parsed = urllib.parse.urlparse(href)
        params = urllib.parse.parse_qs(parsed.query)
        uddg = params.get("uddg", [""])[0]
        return urllib.parse.unquote(uddg) if uddg else href

    class _Parser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.results: list[dict] = []
            self._in_result_link = False   # inside <a class='result-link'>
            self._in_snippet_td = False    # inside <td class='result-snippet'>
            self._buf: str = ""
            self._pending: dict = {}       # holds title+url while we wait for snippet

        def handle_starttag(self, tag, attrs):
            d = dict(attrs)
            if tag == "a" and d.get("class") == "result-link":
                self._in_result_link = True
                self._buf = ""
                self._pending = {"url": _decode_ddg_url(d.get("href", ""))}
            elif tag == "td" and d.get("class") == "result-snippet":
                self._in_snippet_td = True
                self._buf = ""

        def handle_endtag(self, tag):
            if tag == "a" and self._in_result_link:
                self._pending["title"] = self._buf.strip()
                self._in_result_link = False
                self._buf = ""
            elif tag == "td" and self._in_snippet_td:
                if self._pending:
                    self._pending["snippet"] = self._buf.strip()
                    self.results.append(self._pending)
                    self._pending = {}
                self._in_snippet_td = False
                self._buf = ""

        def _collect(self, data: str):
            if self._in_result_link or self._in_snippet_td:
                self._buf += data

        def handle_data(self, data):
            self._collect(data)

        def handle_entityref(self, name):
            from html import unescape
            self._collect(unescape(f"&{name};"))

        def handle_charref(self, name):
            from html import unescape
            self._collect(unescape(f"&#{name};"))

    p = _Parser()
    p.feed(html)
    return p.results[:max_results]


def _extract_readable_text(html: str) -> tuple[str, str]:
    """Strip HTML tags and return (title, body_text)."""
    from html.parser import HTMLParser

    class _Extractor(HTMLParser):
        SKIP = {"script", "style", "noscript", "nav", "footer", "form", "head"}

        def __init__(self):
            super().__init__()
            self._skip_depth = 0
            self._title_mode = False
            self.title = ""
            self.parts: list[str] = []

        def handle_starttag(self, tag, attrs):
            if tag == "title":
                self._title_mode = True
            if tag in self.SKIP:
                self._skip_depth += 1
            if tag in ("p", "h1", "h2", "h3", "h4", "h5", "li", "br", "tr"):
                self.parts.append("\n")

        def handle_endtag(self, tag):
            if tag == "title":
                self._title_mode = False
            if tag in self.SKIP:
                self._skip_depth = max(0, self._skip_depth - 1)

        def handle_data(self, data):
            if self._title_mode and not self.title:
                self.title = data.strip()
            elif self._skip_depth == 0:
                self.parts.append(data)

        def handle_entityref(self, name):
            from html import unescape
            if self._skip_depth == 0:
                self.parts.append(unescape(f"&{name};"))

        def handle_charref(self, name):
            from html import unescape
            if self._skip_depth == 0:
                self.parts.append(unescape(f"&#{name};"))

    e = _Extractor()
    e.feed(html)
    return e.title, "".join(e.parts)


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
            case "fetch_emails":
                return self._fetch_emails(**arguments)
            case "search_obsidian":
                return self._search_obsidian(**arguments)
            case "create_obsidian_page":
                return self._create_obsidian_page(**arguments)
            case "update_obsidian_page":
                return self._update_obsidian_page(**arguments)
            case "web_search":
                return self._web_search(**arguments)
            case "web_fetch":
                return self._web_fetch(**arguments)
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

    def _fetch_emails(
        self,
        max_count: int = 10,
        unread_only: bool = False,
        from_filter: str | None = None,
        subject_filter: str | None = None,
    ) -> str:
        """Return emails from the local cache, formatted for LLM consumption."""
        try:
            import email_client as ec
            emails = ec.list_emails(limit=max_count * 4)  # over-fetch then filter
            if unread_only:
                emails = [e for e in emails if not e.get("read")]
            if from_filter:
                emails = [e for e in emails if from_filter.lower() in (e.get("from") or "").lower()]
            if subject_filter:
                emails = [e for e in emails if subject_filter.lower() in (e.get("subject") or "").lower()]
            emails = emails[:max_count]

            if not emails:
                return "No emails found matching the criteria."

            lines = [f"Found {len(emails)} email(s):\n"]
            for i, em in enumerate(emails, 1):
                lines.append(
                    f"{i}. From: {em.get('from', '')}\n"
                    f"   Subject: {em.get('subject', '')}\n"
                    f"   Date: {em.get('date', '')}\n"
                    f"   ID: {em.get('id', '')}\n"
                    f"   Read: {em.get('read', False)}\n"
                )
            return "\n".join(lines)
        except Exception as e:
            log.exception("fetch_emails tool failed")
            return f"Error fetching emails: {e}"

    def _search_obsidian(self, query: str, scope: str | None = None) -> str:
        """Semantic search within the Obsidian vault scope."""
        try:
            scope_name = scope or obsidian_ops._default_obsidian_scope()
            if scope_name is None:
                return "No Obsidian vault scope configured."
            results = rag.query_scopes(query, [scope_name])
            return results or "No results found."
        except Exception as e:
            log.exception("search_obsidian tool failed")
            return f"Error searching vault: {e}"

    def _create_obsidian_page(
        self,
        path: str,
        content: str,
        explanation: str = "Create Obsidian page",
        scope: str | None = None,
    ) -> str:
        """Create a new page in the Obsidian vault."""
        try:
            scope_name = scope or obsidian_ops._default_obsidian_scope()
            if scope_name is None:
                return "No Obsidian vault scope configured."
            result = obsidian_ops.propose_page_create(scope_name, path, content, explanation)
            msg = f"Created page: {result['written']}"
            if result.get("warning"):
                msg += f"\nWarning: {result['warning']}"
            return msg
        except Exception as e:
            log.exception("create_obsidian_page tool failed")
            return f"Error creating page: {e}"

    def _update_obsidian_page(
        self,
        path: str,
        new_section_content: str,
        section_header: str = "",
        explanation: str = "Update Obsidian page",
        scope: str | None = None,
    ) -> str:
        """Update a section of an existing Obsidian page."""
        try:
            scope_name = scope or obsidian_ops._default_obsidian_scope()
            if scope_name is None:
                return "No Obsidian vault scope configured."
            result = obsidian_ops.propose_page_update(
                scope_name, path, section_header, new_section_content, explanation
            )
            msg = f"Updated page: {result['written']}"
            if result.get("warning"):
                msg += f"\nWarning: {result['warning']}"
            return msg
        except Exception as e:
            log.exception("update_obsidian_page tool failed")
            return f"Error updating page: {e}"

    def _web_search(self, query: str, max_results: int = 5) -> str:
        """Search the web using DuckDuckGo lite and return results."""
        import urllib.request
        import urllib.parse
        from html.parser import HTMLParser

        if not getattr(config, "WEB_SEARCH_ENABLED", False):
            return "Web search is disabled. Enable it in Settings → General."

        try:
            params = urllib.parse.urlencode({"q": query})
            url = f"https://lite.duckduckgo.com/lite/?{params}"
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
                "Accept": "text/html",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")

            results = _parse_ddg_lite(html, max_results)

            if not results:
                return f'No results found for: "{query}"'

            lines = [f'Web search results for: "{query}"\n']
            for i, r in enumerate(results, 1):
                lines.append(f"{i}. {r['title']}")
                lines.append(f"   URL: {r['url']}")
                if r.get("snippet"):
                    lines.append(f"   {r['snippet']}")
                lines.append("")
            return "\n".join(lines)

        except Exception as e:
            log.exception("web_search failed")
            return f"Error performing web search: {e}"

    def _web_fetch(self, url: str, max_chars: int = 8000) -> str:
        """Fetch a URL and return its readable text content."""
        import urllib.request
        from html.parser import HTMLParser
        import re

        if not getattr(config, "WEB_SEARCH_ENABLED", False):
            return "Web fetch is disabled. Enable it in Settings → General."

        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
                "Accept": "text/html,application/xhtml+xml,text/plain",
                "Accept-Language": "en-US,en;q=0.9",
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                content_type = resp.headers.get("content-type", "")
                raw = resp.read(1_000_000)  # cap at 1MB

            if "text/plain" in content_type:
                text = raw.decode("utf-8", errors="replace")
                title = ""
            else:
                html = raw.decode("utf-8", errors="replace")
                title, text = _extract_readable_text(html)

            # Normalise whitespace
            text = re.sub(r"\n{3,}", "\n\n", text).strip()
            if len(text) > max_chars:
                text = text[:max_chars] + f"\n\n[Truncated — {len(text) - max_chars} chars omitted]"

            header = f"URL: {url}\n"
            if title:
                header += f"Title: {title}\n"
            log.info("web_fetch: %s (%d chars returned)", url, len(text))
            return header + "\n" + text

        except Exception as e:
            log.exception("web_fetch failed")
            return f"Error fetching URL: {e}"

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
        },
        {
            "type": "function",
            "function": {
                "name": "fetch_emails",
                "description": "Read emails from the local email cache. Use this to answer questions about recent emails, find messages from specific senders, or retrieve information from the inbox.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "max_count": {
                            "type": "integer",
                            "description": "Maximum number of emails to return (default 10)",
                            "default": 10
                        },
                        "unread_only": {
                            "type": "boolean",
                            "description": "If true, only return unread emails",
                            "default": False
                        },
                        "from_filter": {
                            "type": "string",
                            "description": "Optional: filter emails by sender (substring match)"
                        },
                        "subject_filter": {
                            "type": "string",
                            "description": "Optional: filter emails by subject (substring match)"
                        }
                    },
                    "required": []
                }
            }
        }
    ] + _obsidian_tool_definitions() + _web_tool_definitions()


def _web_tool_definitions() -> list[dict]:
    if not getattr(config, "WEB_SEARCH_ENABLED", False):
        return []
    return [
        {
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "Search the web for current information, news, documentation, or anything not in local files. Returns a list of results with titles, URLs, and snippets. Use web_fetch to read the full content of a promising result.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query"
                        },
                        "max_results": {
                            "type": "integer",
                            "description": "Number of results to return (default 5, max 10)",
                            "default": 5
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "web_fetch",
                "description": "Fetch the readable text content of a URL. Use this after web_search to read the full content of a specific page, or when the user provides a URL to read.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "url": {
                            "type": "string",
                            "description": "The full URL to fetch (must start with http:// or https://)"
                        },
                        "max_chars": {
                            "type": "integer",
                            "description": "Maximum characters to return (default 8000)",
                            "default": 8000
                        }
                    },
                    "required": ["url"]
                }
            }
        },
    ]


def _obsidian_tool_definitions() -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": "search_obsidian",
                "description": "Semantic search within the Obsidian vault. Use to find notes related to a topic.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "The search query"
                        },
                        "scope": {
                            "type": "string",
                            "description": "Vault scope name (optional, defaults to the configured Obsidian scope)"
                        }
                    },
                    "required": ["query"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "create_obsidian_page",
                "description": "Create a new Obsidian vault note. Include YAML frontmatter with title and tags.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path within the vault, e.g. 'Projects/my-note.md'"
                        },
                        "content": {
                            "type": "string",
                            "description": "Full markdown content including frontmatter"
                        },
                        "explanation": {
                            "type": "string",
                            "description": "Why this page is being created"
                        },
                        "scope": {
                            "type": "string",
                            "description": "Vault scope name (optional)"
                        }
                    },
                    "required": ["path", "content", "explanation"]
                }
            }
        },
        {
            "type": "function",
            "function": {
                "name": "update_obsidian_page",
                "description": "Update a specific section of an existing Obsidian vault note. If section_header is empty, replaces the entire body.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": {
                            "type": "string",
                            "description": "Relative path within the vault"
                        },
                        "new_section_content": {
                            "type": "string",
                            "description": "The new content for the section"
                        },
                        "section_header": {
                            "type": "string",
                            "description": "Heading text of the section to replace (without # prefix). Leave empty to replace full body."
                        },
                        "explanation": {
                            "type": "string",
                            "description": "Why this update is being made"
                        },
                        "scope": {
                            "type": "string",
                            "description": "Vault scope name (optional)"
                        }
                    },
                    "required": ["path", "new_section_content", "explanation"]
                }
            }
        },
    ]
