# Tool Calling Architecture

**A complete walkthrough of how tool calling works in SHRIMP's backend**

---

## Overview

SHRIMP uses Ollama's native function calling API to enable agentic workflows. The model can autonomously call tools (read files, search, propose edits) and use the results to answer questions or make changes.

This document walks through the complete flow from HTTP request to response, explaining every function call along the way.

---

## 1. Request Entry Point

**POST /chat** (`main.py:431`)

```python
@app.post("/chat")
async def chat(req: ChatRequest, request: Request):
    # Feature flag check
    if config.USE_TOOL_CALLING:
        return await chat_with_tools(req, request)  # Route to tool calling

    # Otherwise: original prompt-chaining (fallback)
```

**What happens:**
- Request arrives with user message and selected scopes
- Feature flag `USE_TOOL_CALLING` determines routing
- If enabled → tool calling path
- If disabled → prompt-chaining path (original implementation)

---

## 2. Tool Calling Setup

**`chat_with_tools()` function** (`main.py:235`)

```python
async def chat_with_tools(req: ChatRequest, request: Request):
    # A. Build system prompt with scope info
    system_prompt = (
        "You are SHRIMP*, a local AI assistant with access to tools.\n"
        f"Available scopes: {scope_names}\n"
        f"Available tools: list_scope, read_file, search_files, propose_file_edit"
    )

    # B. Initialize messages array
    messages = [
        {"role": "system", "content": system_prompt},
        *req.history,  # Previous conversation
        {"role": "user", "content": req.message}
    ]

    # C. Initialize tool executor
    executor = tool_executor.ToolExecutor()

    # D. Get tool definitions (schemas)
    tools = tool_executor.build_tool_definitions()
    # Returns: [
    #   {"type": "function", "function": {"name": "read_file", "parameters": {...}}},
    #   {"type": "function", "function": {"name": "search_files", "parameters": {...}}},
    #   ...
    # ]
```

**What happens:**
1. **System Prompt**: Tells the model what scopes and tools are available
2. **Messages Array**: Builds conversation history (system + history + user message)
3. **Tool Executor**: Initializes `ToolExecutor()` instance to track state
4. **Tool Definitions**: Gets JSON schemas for all 4 tools in Ollama's format

**Tool schemas include:**
- Tool name (e.g., `"read_file"`)
- Description (what the tool does)
- Parameters (type, required fields, descriptions)

---

## 3. Agentic Loop Starts

**Inside the `stream()` generator** (`main.py:299`)

```python
async def stream():
    iteration = 0
    max_iterations = 10  # Safety limit

    while iteration < max_iterations:
        iteration += 1

        # ────────────────────────────────────────────────────
        # STEP 1: Call Ollama with tools
        # ────────────────────────────────────────────────────

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "http://127.0.0.1:11434/api/chat",
                json={
                    "model": "llama3.1:8b",
                    "messages": messages,          # Conversation history
                    "tools": tools,                 # Tool definitions
                    "stream": False,
                    "options": {"num_ctx": 16384}
                }
            )

        data = resp.json()
        message = data.get("message", {})
        content = message.get("content", "")        # Text response
        tool_calls = message.get("tool_calls", [])  # Structured tool calls
```

**What happens:**
1. **HTTP POST** to Ollama's `/api/chat` endpoint
2. **Payload includes:**
   - Model name (`llama3.1:8b`)
   - Full conversation history
   - Tool definitions (tells model what functions are available)
   - Context window size
3. **Ollama's LLM decides:**
   - Does it need to call a tool to answer the question?
   - Which tool(s) should it call?
   - What arguments to pass?
4. **Response contains:**
   - `content`: Text response (thinking, explanations)
   - `tool_calls`: Array of function calls with arguments

---

## 4. Tool Call Parsing

**Fallback parser for text-based tool calls** (`main.py:341`)

```python
        # ────────────────────────────────────────────────────
        # STEP 2: Parse tool calls (with fallback)
        # ────────────────────────────────────────────────────

        # If model outputs JSON text instead of structured tool_calls:
        # Example: {"name": "search_files", "parameters": {"query":"...", "scopes":["obsidian"]}}

        if not tool_calls and content and '{"name":' in content:
            # Use regex to extract tool calls from content
            json_pattern = r'\{"name":\s*"([^"]+)",\s*"parameters":\s*(\{[^\}]*\})\}'
            matches = re.findall(json_pattern, content, re.DOTALL)

            for tool_name, params_str in matches:
                params = json.loads(params_str)
                tool_calls.append({
                    "function": {
                        "name": tool_name,
                        "arguments": params
                    }
                })

        # Append assistant's message to conversation history
        messages.append(message)

        # Stream any text content to user
        if content:
            yield content
```

**What happens:**
1. **Check for structured tool calls** in `message.tool_calls`
2. **If empty**: Fall back to parsing JSON from text content
   - Some models output tool calls as plain text JSON
   - Regex extracts `{"name": "...", "parameters": {...}}`
   - Parse into structured format
3. **Append message** to conversation history
4. **Stream content** to user if present (thinking/explanations)

**Why the fallback?**
- llama3.1:8b sometimes outputs tool calls as text instead of structured JSON
- This ensures tool calling works regardless of format
- Maintains compatibility with different model behaviors

---

## 5. Tool Execution

**Execute each tool call** (`main.py:375`)

```python
        # ────────────────────────────────────────────────────
        # STEP 3: Execute tools
        # ────────────────────────────────────────────────────

        if not tool_calls:
            break  # No more tools to call - done!

        for tool_call in tool_calls:
            func = tool_call.get("function", {})
            tool_name = func.get("name")          # e.g., "search_files"
            arguments = func.get("arguments", {})  # e.g., {"query": "DND", "scopes": ["obsidian"]}

            # ────────────────────────────────────────────────
            # Call ToolExecutor.execute()
            # ────────────────────────────────────────────────
            result = executor.execute(tool_name, arguments)

            # Append tool result to conversation
            messages.append({
                "role": "tool",
                "content": result  # Tool output as string
            })
```

**What happens:**
1. **Check if done**: No tool calls → exit loop
2. **For each tool call**:
   - Extract tool name and arguments
   - Call `executor.execute(tool_name, arguments)`
   - Get result as string
3. **Append tool result** to messages with `role: "tool"`
4. **Loop continues** with updated conversation

**Result flow:**
```
User: "Check my DND notes"
  ↓
Model: [calls search_files]
  ↓
Tool: "# Session 12\nDate: 2026-03-20..."
  ↓
Model: [sees result] "Your last session was #12"
```

---

## 6. Inside ToolExecutor

**`tool_executor.py:execute()`**

```python
def execute(self, tool_name: str, arguments: dict) -> str:
    # Rate limiting check
    self.tool_call_count += 1
    if self.tool_call_count > 50:
        raise ValueError("Tool call limit exceeded")

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
```

**What happens:**
1. **Rate limit check**: Prevents infinite loops (max 50 calls/request)
2. **Dispatch**: Uses pattern matching to call the right tool method
3. **Execute tool**: Calls private method (e.g., `_search_files()`)
4. **Return result**: String containing tool output or error message

**Safety features:**
- Rate limiting prevents runaway tool calling
- Unknown tool names raise errors
- All errors caught and returned as strings (no crashes)

---

## 7. Individual Tool Implementations

### Tool 1: `_search_files()`

**Semantic search across indexed scopes**

```python
def _search_files(self, query: str, scopes: list[str], top_k: int = 5) -> str:
    # A. Validate scopes exist
    valid_scopes = [s["name"] for s in config.WATCHED_DIRS if s.get("enabled")]
    invalid = [s for s in scopes if s not in valid_scopes]
    if invalid:
        return f"Error: Invalid scopes: {', '.join(invalid)}"

    # B. Call RAG system
    context = rag.query_scopes(query, scopes)
    #         ↓
    #    Uses LlamaIndex to:
    #    1. Embed the query (nomic-embed-text)
    #    2. Search ChromaDB vector store
    #    3. Return top-k relevant chunks

    return context  # Returns formatted context string
```

**Flow:**
1. Validate all requested scopes exist
2. Call `rag.query_scopes()` which:
   - Embeds the query using `nomic-embed-text`
   - Searches ChromaDB vector store
   - Retrieves top-5 most relevant chunks
   - Formats results with scope/file metadata
3. Return formatted context string

**Example output:**
```
--- context from scope: obsidian ---
# Session 12
Date: 2026-03-20
Location: Bryn Shander
...
```

### Tool 2: `_read_file()`

**Read complete file contents**

```python
def _read_file(self, scope: str, path: str) -> str:
    try:
        # Calls rag.py which does security validation
        content = rag.read_file_from_scope(scope, path)
        #         ↓
        #    1. Validates scope exists
        #    2. Resolves path (prevents ../ attacks)
        #    3. Checks file exists
        #    4. Reads content

        return f"File: {scope}/{path}\n\n{content}"
    except FileNotFoundError:
        return f"Error: File not found - {scope}/{path}"
```

**Flow:**
1. Call `rag.read_file_from_scope()` which:
   - Validates scope exists in config
   - Resolves full file path
   - Checks path doesn't escape scope root (security)
   - Reads file content (max 500KB)
2. Return formatted content with file path header
3. If file not found, return error message

**Security:**
- Path traversal attacks blocked (`../../../etc/passwd` → error)
- Files must be within scope root
- Size limit prevents memory issues

### Tool 3: `_list_scope()`

**Get file tree for a scope**

```python
def _list_scope(self, scope: str, max_files: int = 150) -> str:
    # Validate scope exists
    if scope not in [s["name"] for s in config.WATCHED_DIRS]:
        return f"Error: Scope '{scope}' does not exist"

    # Get structural summary
    summary = rag.get_structural_summary([scope], max_files=max_files)
    #         ↓
    #    Returns file tree as formatted string:
    #    --- scope: shrimp (234 files total) ---
    #    backend/main.py
    #    backend/config.py
    #    ...

    return summary
```

**Flow:**
1. Validate scope exists
2. Call `rag.get_structural_summary()` which:
   - Gets cached file tree from structural map
   - Formats as text list (limited to max_files)
   - Includes file counts and metadata
3. Return formatted file tree

**Use case:**
- Model calls this to see what files are available
- Then calls `read_file()` on specific files
- Enables multi-step exploration

### Tool 4: `_propose_file_edit()`

**Propose a file change (accumulate, don't write)**

```python
def _propose_file_edit(self, scope: str, path: str, new_content: str, explanation: str) -> str:
    # Security validation
    scope_obj = next((s for s in config.WATCHED_DIRS if s["name"] == scope), None)
    root = Path(scope_obj["path"]).expanduser().resolve()
    target = (root / path).resolve()

    # Critical check: prevent path traversal
    if not str(target).startswith(str(root)):
        return f"Error: Path escapes scope root"

    # Accumulate edit (doesn't write yet!)
    self.proposed_edits.append({
        "scope": scope,
        "path": path,
        "new_content": new_content,
        "explanation": explanation
    })

    return f"Edit proposed for {scope}/{path}. {explanation}"
```

**Flow:**
1. Validate scope exists
2. Resolve full file path
3. **Security check**: Ensure path doesn't escape scope root
4. **Accumulate edit** in memory (no disk write!)
5. Return confirmation message

**Key point:**
- Edits are **proposed**, not applied
- Stored in `executor.proposed_edits` list
- Only written to disk after user approval
- Multiple edits accumulate for batch review

---

## 8. Loop Continues

**Back to agentic loop** (`main.py:304`)

After tool execution, messages array is updated:

```python
messages = [
    {"role": "system", "content": "You are SHRIMP with tools..."},
    {"role": "user", "content": "check my DND notes"},
    {"role": "assistant", "content": "", "tool_calls": [...]},
    {"role": "tool", "content": "--- context from scope: obsidian ---\n# Session 12\n..."},
]
```

**Next iteration:**
1. Send updated messages to Ollama
2. Model sees tool result in context
3. Decides what to do next:
   - Call another tool?
   - Generate final answer?
   - Propose an edit?
4. If no more tool calls → loop exits

**Example multi-step workflow:**
```
Iteration 1: User asks "Fix the bug in main.py line 42"
  → Model calls: list_scope("shrimp")
  → Gets: "backend/main.py, backend/config.py, ..."

Iteration 2: Model sees file list
  → Model calls: read_file("shrimp", "backend/main.py")
  → Gets: [full file content]

Iteration 3: Model sees file content
  → Model calls: propose_file_edit("shrimp", "backend/main.py", [...fixed code...], "Fixed bug")
  → Gets: "Edit proposed"

Iteration 4: Model sees confirmation
  → No more tools needed
  → Generates: "I've proposed a fix for the bug in main.py..."
  → Loop exits
```

---

## 9. Sentinel Emission

**After loop completes** (`main.py:400`)

```python
        # ────────────────────────────────────────────────────
        # STEP 4: Emit sentinels if edits were proposed
        # ────────────────────────────────────────────────────

        if executor.has_proposed_edits():
            edits = executor.get_proposed_edits()

            if len(edits) == 1:
                # Single file edit
                edit = edits[0]
                original = rag.read_file_from_scope(edit["scope"], edit["path"])

                sentinel = json.dumps({
                    "scope": edit["scope"],
                    "path": edit["path"],
                    "old": original,
                    "new": edit["new_content"]
                })
                yield f"\n\n__SHRIMP_EDIT__{sentinel}"

            else:
                # Multi-file edit
                file_diffs = []
                for edit in edits:
                    original = rag.read_file_from_scope(edit["scope"], edit["path"])
                    file_diffs.append({
                        "scope": edit["scope"],
                        "path": edit["path"],
                        "old": original,
                        "new": edit["new_content"]
                    })
                sentinel = json.dumps({"files": file_diffs})
                yield f"\n\n__SHRIMP_MULTI_EDIT__{sentinel}"

        yield "__STAGE__done"
```

**What happens:**
1. **Check for edits**: Did model propose any file changes?
2. **Single file**: Emit `__SHRIMP_EDIT__` with diff payload
3. **Multiple files**: Emit `__SHRIMP_MULTI_EDIT__` with array of diffs
4. **Emit `__STAGE__done`**: Signals streaming complete

**Sentinel format:**
```
__SHRIMP_EDIT__{"scope":"shrimp","path":"backend/main.py","old":"...","new":"..."}
```

Frontend parses this and shows diff viewer.

---

## 10. Frontend Processing

**Frontend receives streaming response**:

1. **Text chunks** appear in real-time (streamed via `yield`)
2. **Stage markers** update UI (`__STAGE__thinking`, `__STAGE__done`)
3. **Sentinel detection** (`__SHRIMP_EDIT__`):
   - Parse JSON payload
   - Open `DiffPanel` or `MultiFileDiffPanel`
   - Show old vs new content
   - Provide approve/reject buttons
4. **On approval**:
   - `POST /file/apply` with scope, path, content
   - Backend calls `file_ops.write_accept()`
   - File written with backup created
   - Success response sent

---

## Complete Example Flow

**User asks:** "Check my DND notes. What session number is next?"

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. POST /chat → chat_with_tools()                              │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Messages sent to Ollama:                                     │
│    [                                                             │
│      {role: "system", content: "You are SHRIMP..."},           │
│      {role: "user", content: "Check my DND notes..."}          │
│    ]                                                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. Ollama (llama3.1:8b) responds with tool call:               │
│    {                                                             │
│      tool_calls: [{                                              │
│        function: {                                               │
│          name: "search_files",                                   │
│          arguments: {                                            │
│            query: "DND session number",                          │
│            scopes: ["obsidian"]                                  │
│          }                                                        │
│        }                                                          │
│      }]                                                           │
│    }                                                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. executor.execute("search_files", {...})                      │
│    └─> _search_files()                                          │
│        └─> rag.query_scopes()                                   │
│            └─> Embed query with nomic-embed-text                │
│            └─> Search ChromaDB vector store                     │
│            └─> Return top-5 chunks                              │
│                                                                  │
│    Result: "--- context from scope: obsidian ---                │
│             # Session 12                                         │
│             Date: 2026-03-20                                     │
│             Location: Bryn Shander..."                           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. Messages updated:                                             │
│    [                                                             │
│      {role: "system", ...},                                     │
│      {role: "user", ...},                                       │
│      {role: "assistant", content: "", tool_calls: [...]},       │
│      {role: "tool", content: "# Session 12\nDate: 2026-03-20"}  │
│    ]                                                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. Loop iteration 2 - send updated messages to Ollama           │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. Ollama responds with final answer:                           │
│    {                                                             │
│      content: "Based on your notes, your last session was       │
│                #12 on March 20th in Bryn Shander. The next      │
│                session will be #13.",                            │
│      tool_calls: []  // No more tools needed                    │
│    }                                                             │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ 8. No tool calls → loop exits                                   │
│    → Stream response to user                                    │
│    → Emit __STAGE__done                                         │
│    → Done!                                                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Architectural Points

### 1. Agentic Loop
- Model makes **autonomous decisions** about which tools to call
- Can call tools **multiple times** in sequence
- Sees tool results and adapts strategy
- No hardcoded workflow - model decides the flow

### 2. Security by Design
- **All file operations** go through security validation
- Path traversal attacks prevented
- File writes only after user approval
- Rate limiting prevents abuse

### 3. Fallback Compatibility
- Handles structured `tool_calls` field (standard)
- Falls back to parsing JSON from text content (compatibility)
- Works with multiple model formats
- Graceful degradation

### 4. Edit Accumulation
- Edits **proposed** during tool calls
- **Not written** to disk immediately
- User reviews all changes via diff viewer
- Atomic application after approval

### 5. Streaming Architecture
- User sees progress in real-time
- Stage markers update UI state
- Sentinels trigger diff views
- Responsive UX despite multi-step workflows

---

## Performance Characteristics

**From reliability testing (80 requests):**

| Metric | Value |
|--------|-------|
| Overall success rate | 93.8% |
| read_file success | 100% |
| search_files success | 95% |
| Avg response time | 4.57s |
| Avg iterations | ~2 |
| Max iterations | 10 (safety limit) |

**Typical request breakdown:**
- Iteration 1: Tool calls (1-3 tools)
- Iteration 2: Final answer with context
- Total: 2 iterations, 5-10 seconds

---

## Error Handling

**At each layer:**

1. **Tool Executor**: Rate limiting, unknown tool detection
2. **Tool Methods**: Input validation, security checks
3. **RAG Layer**: File existence, path validation
4. **Agentic Loop**: Timeout, iteration limit
5. **Frontend**: Graceful error display

**All errors returned as strings:**
```python
return "Error: File not found - shrimp/nonexistent.py"
```

Model sees error, can adapt strategy or inform user.

---

## Future Enhancements

**Potential improvements:**

1. **Streaming tool calls**: Enable `stream=True` for faster first-token
2. **Tool result truncation**: Limit large file reads to relevant sections
3. **Parallel tool execution**: Call multiple tools simultaneously
4. **Tool call caching**: Cache results for repeated calls
5. **Advanced tools**:
   - `git_diff()` - Get changes since last commit
   - `run_tests()` - Execute test suite
   - `create_file()` - Create new files
   - `delete_file()` - Remove files

---

## Comparison: Tool Calling vs Prompt-Chaining

| Aspect | Tool Calling | Prompt-Chaining |
|--------|--------------|-----------------|
| LLM roundtrips | 2-3 per request | 3-5 per request |
| Intent detection | Implicit (model decides) | Explicit (separate call) |
| File selection | Automatic (model calls list/search) | Explicit (separate call) |
| Multi-step workflows | Native (agentic loop) | Manual (sequential prompts) |
| Extensibility | Add tool = add function | Add feature = new prompts |
| Reliability | 93.8% (tested) | ~85% (estimated) |
| Code complexity | ~700 lines | ~1200 lines |

**Tool calling eliminates:**
- Intent detection prompt (1 LLM call)
- File selection prompt (1 LLM call)
- Regex sentinel parsing (brittle)
- JSON extraction from responses

---

## Debugging Tips

**Enable debug logging:**
```python
# backend/main.py
log.setLevel(logging.DEBUG)
```

**Check tool execution:**
```bash
tail -f .ollama/backend.log | grep tool
```

**Verify tool calls:**
```bash
# Look for:
# "chat_with_tools: executing <tool_name>"
# "Executing tool: <tool_name> (call #N)"
```

**Test individual tools:**
```python
from tool_executor import ToolExecutor

executor = ToolExecutor()
result = executor.execute("list_scope", {"scope": "shrimp"})
print(result)
```

---

## References

- **Main implementation**: `backend/main.py:235` (`chat_with_tools()`)
- **Tool executor**: `backend/tool_executor.py`
- **Tool definitions**: `backend/tool_executor.py:build_tool_definitions()`
- **RAG layer**: `backend/rag.py`
- **File security**: `backend/file_ops.py`
- **Integration tests**: `backend/test_tool_calling_integration.py`
- **Reliability tests**: `backend/test_tool_calling_reliability.py`

---

**Questions or issues?** Check the implementation code or create an issue in the repo.
