from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pathlib import Path
from sse_starlette.sse import EventSourceResponse
import httpx
import json
import logging
import re
import asyncio
import queue
import threading
import config
import rag

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("shrimp.main")

app = FastAPI(title="SHRIMP*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── models ────────────────────────────────────────────────────────────────────


class ChatRequest(BaseModel):
    message: str
    scopes: list[str] = []
    history: list[dict] = []
    # {"path": str, "content": str, "scope": str}
    pending_file: dict | None = None


class Scope(BaseModel):
    name: str
    path: str
    enabled: bool


class ScopeUpdate(BaseModel):
    scopes: list[dict]


class ModelUpdate(BaseModel):
    model: str


class ApplyEditRequest(BaseModel):
    scope: str
    path: str
    content: str

class CtxUpdate(BaseModel):
    num_ctx: int

# ── config helpers ────────────────────────────────────────────────────────────


def write_config(scopes: list[dict], model: str):
    config_path = Path(__file__).parent / "config.py"
    current = config_path.read_text()
    current = re.sub(
        r"WATCHED_DIRS: list\[dict\] = \[.*?\]",
        "WATCHED_DIRS: list[dict] = " + repr(scopes),
        current,
        flags=re.DOTALL,
    )
    current = re.sub(
        r'OLLAMA_MODEL = ".*?"',
        f'OLLAMA_MODEL = "{model}"',
        current,
    )
    config_path.write_text(current)
    log.info("config.py written: model=%s  scopes=%s",
             model, [s["name"] for s in scopes])


# ── section extraction ────────────────────────────────────────────────────────


def extract_section(content: str, message: str) -> tuple[str, int, int] | None:
    """
    Find the section in content most relevant to the edit message.
    Returns (section_text, start_pos, end_pos) or None.
    Matches by keyword overlap between the message and header text.
    """
    headers = list(re.finditer(r"^(#{1,6}) .+", content, re.MULTILINE))
    if not headers:
        return None

    message_lower = message.lower()
    message_tokens = set(re.split(r"\W+", message_lower))
    best = None
    best_score = 0

    for i, h in enumerate(headers):
        header_text = h.group(0).lower()
        header_tokens = set(re.split(r"\W+", header_text))
        # count exact token matches — includes numbers like "3", "4"
        score = len(header_tokens & message_tokens)
        if score > best_score:
            best_score = score
            best = i

    if best is None or best_score == 0:
        return None

    h = headers[best]
    level = len(h.group(1))
    start = h.start()

    # section ends at next header of same or higher level
    end = len(content)
    for next_h in headers[best + 1:]:
        next_level = len(re.match(r"(#+)", next_h.group(0)).group(1))
        if next_level <= level:
            end = next_h.start()
            break

    return content[start:end].strip(), start, end


# ── startup ────────────────────────────────────────────────────────────────────


@app.on_event("startup")
async def startup():
    log.info("Server process startup - hydrating state...")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, rag._hydrate_status)
    await loop.run_in_executor(None, rag.build_all_structural_maps)
    log.info("Startup complete - structural maps and index status ready")


# ── routes: health ────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {"status": "ok", "model": config.OLLAMA_MODEL}


# ── routes: debug ─────────────────────────────────────────────────────────────


@app.get("/debug/prompt")
async def debug_prompt():
    scope_names = [s["name"] for s in config.WATCHED_DIRS if s.get("enabled")]
    file_tree = rag.get_structural_summary(scope_names)
    context = rag.query_scopes("test", scope_names)
    return {
        "scope_names": scope_names,
        "file_tree_length": len(file_tree),
        "file_tree_preview": file_tree[:500],
        "context_preview": context[:500],
    }


@app.get("/debug/find")
async def debug_find(filename: str, scope: str):
    return rag.find_file_in_scopes(filename, [scope])


# ── routes: chat ──────────────────────────────────────────────────────────────


@app.post("/chat")
async def chat(req: ChatRequest, request: Request):
    enabled = [s for s in config.WATCHED_DIRS if s["enabled"]]
    active = [s for s in enabled if s["name"]
              in req.scopes] if req.scopes else enabled

    if not active:
        raise HTTPException(
            status_code=400, detail="No active scopes selected")

    scope_names = [s["name"] for s in active]
    log.info("chat: scopes=%s  message=%r", scope_names, req.message[:80])
    file_tree = rag.get_structural_summary(scope_names, max_files=150)

    # ── step 1a: intent detection ─────────────────────────────────────────────
    # Include recent history so follow-up messages like "yeah go ahead" are
    # understood in context of what was just discussed.
    recent_history = req.history[-6:] if len(req.history) > 6 else req.history

    intent_prompt = (
        "You are an intent detection assistant. Decide if the user wants you to "
        "ACTUALLY EDIT a file right now, or if they're asking a question.\n\n"
        "Respond {\"is_file_edit\": true} if:\n"
        "- Direct edit commands: 'update X to say Y', 'add Z to file A', 'change B to C'\n"
        "- Confirmation of a previous proposal: 'yes do it', 'go ahead', 'apply that change'\n"
        "- Imperative requests: 'fix the bug in X', 'refactor Y'\n\n"
        "Respond {\"is_file_edit\": false} if:\n"
        "- Questions about implementation: 'how would I add X?', 'what's the best way to Y?'\n"
        "- Requests for explanation: 'how does X work?', 'explain the architecture'\n"
        "- Asking for suggestions: 'how should I implement Z?', 'what changes are needed?'\n"
        "- General discussion: 'tell me about X', 'what files handle Y?'\n\n"
        "Key distinction:\n"
        "- 'how would I update README?' → false (asking for guidance)\n"
        "- 'update README to include X' → true (requesting actual edit)\n\n"
        "Consider conversation context for follow-ups like 'yeah' or 'do it'.\n"
        "Respond with JSON only. No explanation.\n\n"
        f"LATEST USER MESSAGE: {req.message}"
    )

    is_file_edit = False
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{config.OLLAMA_HOST}/api/chat",
                json={
                    "model": config.OLLAMA_MODEL,
                    "messages": [
                        *recent_history,
                        {"role": "user", "content": intent_prompt},
                    ],
                    "stream": False,
                    "format": "json",
                    "options": {"num_ctx": config.NUM_CTX},
                },
            )
            raw = resp.json().get("message", {}).get("content", "{}")
            parsed = json.loads(raw)
            is_file_edit = parsed.get("is_file_edit", False)
            log.info("chat: intent detection — is_file_edit=%s", is_file_edit)
    except Exception as e:
        log.warning(
            "chat: intent detection failed (%s) — assuming not a file edit", e)

    # ── step 1b: file selection ───────────────────────────────────────────────
    file_selection_prompt = (
        "You are a file selection assistant. Given a file tree and a conversation, "
        "decide if the latest user message requires reading specific files.\n\n"
        "Rules:\n"
        "- The scope keys MUST be one of the exact scope names listed below. "
        "Never use a file path as a scope key.\n"
        f"- Valid scope names: {scope_names}\n"
        "- If no files are needed, respond with: "
        '{"needs_files": false}\n'
        "- If specific files would help, use this format exactly: "
        '{"needs_files": true, "files": {"obsidian": ["path/to/file.md"]}}\n'
        "- Only include files that actually exist in the tree below.\n"
        "- Consider the full conversation — the user may be referring to a file "
        "mentioned earlier without naming it again.\n"
        "- Maximum 5 files total across all scopes.\n"
        "- Respond with JSON only. No explanation, no markdown.\n\n"
        f"VALID SCOPE NAMES: {scope_names}\n\n"
        f"FILE TREE:\n{file_tree}\n\n"
        f"LATEST USER MESSAGE: {req.message}"
    )

    selected_files: dict[str, list[str]] = {}
    needs_files = False

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{config.OLLAMA_HOST}/api/chat",
                json={
                    "model": config.OLLAMA_MODEL,
                    "messages": [
                        *recent_history,
                        {"role": "user", "content": file_selection_prompt},
                    ],
                    "stream": False,
                    "format": "json",
                    "options": {"num_ctx": config.NUM_CTX},
                },
            )
            raw = resp.json().get("message", {}).get("content", "{}")
            parsed = json.loads(raw)
            needs_files = parsed.get("needs_files", False)
            if needs_files:
                raw_files = parsed.get("files", {})
                # validate scope keys — discard any that aren't real scope names
                selected_files = {
                    k: v for k, v in raw_files.items()
                    if k in scope_names and isinstance(v, list)
                }
                if raw_files and not selected_files:
                    log.warning(
                        "chat: file selection returned invalid scope keys: %s", list(raw_files.keys()))
                else:
                    log.info("chat: file selection — %s", selected_files)
            else:
                log.info("chat: LLM decided no files needed")
    except Exception as e:
        log.warning(
            "chat: file selection pass failed (%s) — falling back to vector index", e)

    # ── step 1b.5: history-based file fallback ───────────────────────────────
    # If file selection found nothing but intent says this is a file edit,
    # scan recent assistant messages for previously identified file paths
    # and reuse them (the user is likely doing a follow-up on the same file).
    if is_file_edit and not selected_files and recent_history:
        for msg in reversed(recent_history):
            if msg.get("role") != "assistant":
                continue
            content = msg.get("content", "")
            # look for scope/path pattern from previous sentinels in history
            for scope_name in scope_names:
                files_in_map = [f["path"]
                                for f in rag.structural_maps.get(scope_name, [])]
                for fp in files_in_map:
                    if fp in content or fp.split("/")[-1] in content:
                        selected_files.setdefault(scope_name, [])
                        if fp not in selected_files[scope_name]:
                            selected_files[scope_name].append(fp)
                            needs_files = True
                            log.info(
                                "chat: history fallback — reusing %s: %s", scope_name, fp)
                            break
                if selected_files:
                    break
            if selected_files:
                break

    # ── step 1c: deterministic file injection ─────────────────────────────────
    # If the message explicitly names a file that exists in the structural map,
    # inject it regardless of what the LLM decided above.
    for scope_name in scope_names:
        for word in re.findall(
            r"\b[\w][\w\-. ]{0,40}\.(?:md|py|ts|tsx|js|json|yaml|yml|toml|txt|sh)\b",
            req.message, re.IGNORECASE
        ):
            word = word.strip()
            if len(word) > 60:
                continue
            matches = rag.find_file_in_scopes(word, [scope_name])
            if matches:
                selected_files.setdefault(scope_name, [])
                for m in matches:
                    if m["path"] not in selected_files[scope_name]:
                        selected_files[scope_name].append(m["path"])
                needs_files = True
                log.info("chat: deterministic injection — %s: %s",
                         scope_name, selected_files[scope_name])

    # ── step 2: gather context ────────────────────────────────────────────────
    context_chunks = []
    full_file_contents: dict[str, str] = {}

    if needs_files and selected_files:
        for scope_name, paths in selected_files.items():
            if not paths:
                continue
            if is_file_edit:
                for path in paths:
                    try:
                        content = rag.read_file_from_scope(scope_name, path)
                        full_file_contents[path] = content
                        log.info("chat: loaded full file for edit: %s", path)
                    except Exception as e:
                        log.warning(
                            "chat: could not read file %s: %s", path, e)
            else:
                chunk = await asyncio.get_event_loop().run_in_executor(
                    None, rag.query_on_demand, req.message, scope_name, paths
                )
                if chunk:
                    context_chunks.append(chunk)
    else:
        context = await asyncio.get_event_loop().run_in_executor(
            None, rag.query_scopes, req.message, scope_names
        )
        if context:
            context_chunks.append(context)

    context = "\n\n".join(context_chunks)

    # ── step 3a: file edit path ───────────────────────────────────────────────
    if is_file_edit and full_file_contents:
        file_path = list(full_file_contents.keys())[0]
        disk_content = full_file_contents[file_path]
        scope_for_file = next(
            (sn for sn, paths in selected_files.items() if file_path in paths),
            scope_names[0]
        )

        # if the frontend has an unapplied pending edit for this file, use that
        # as the working base — otherwise fall back to disk content
        if (req.pending_file
                and req.pending_file.get("path") == file_path
                and req.pending_file.get("content")):
            working_content = req.pending_file["content"]
            log.info("chat: using pending content from frontend (%d chars)", len(
                working_content))
        else:
            working_content = disk_content

        # extract the target section from the working content in Python
        section_result = extract_section(working_content, req.message)
        if section_result:
            section_text, section_start, section_end = section_result
            log.info("chat: extracted section (%d chars) at %d-%d",
                     len(section_text), section_start, section_end)
        else:
            section_text = working_content
            section_start = 0
            section_end = len(working_content)
            log.info("chat: no section match found, editing full file")

        edit_system_prompt = (
            "You are a file editing assistant. You will be given a single section of "
            "a file and an edit instruction. Return ONLY the updated section content. "
            "No explanation, no preamble, no other sections, no commentary. "
            "Preserve the header line exactly as-is. "
            "Do not wrap the content in markdown fences. "
            "Just return the raw updated section text."
        )

        edit_user_prompt = (
            f"Section to edit:\n\n"
            f"{section_text}\n\n"
            f"Edit instruction: {req.message}\n\n"
            "Return the updated section only. Keep the header line unchanged. "
            "Do not include any other sections."
        )

        edit_messages = [
            {"role": "system", "content": edit_system_prompt},
            *req.history,
            {"role": "user", "content": edit_user_prompt},
        ]

        log.info("chat: file edit chain — generating content for %s", file_path)

        async def stream_file_edit_inner():
            yield "__STAGE__thinking"
            new_content_parts = []
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    "POST",
                    f"{config.OLLAMA_HOST}/api/chat",
                    json={
                        "model": config.OLLAMA_MODEL,
                        "messages": edit_messages,
                        "stream": True,
                        "options": {"num_ctx": config.NUM_CTX},
                    },
                ) as resp:
                    async for line in resp.aiter_lines():
                        if await request.is_disconnected():
                            log.info(
                                "chat: client disconnected during file edit stream")
                            return
                        if line:
                            data = json.loads(line)
                            if token := data.get("message", {}).get("content"):
                                new_content_parts.append(token)
                            if data.get("done"):
                                break

            new_content = "".join(new_content_parts).strip()
            log.info("chat: file edit generated %d chars", len(new_content))

            # splice into working_content (may be a pending unapplied edit)
            spliced = (
                working_content[:section_start]
                + new_content
                + "\n\n"
                + working_content[section_end:]
            ).strip()
            log.info("chat: spliced at %d-%d, result %d chars",
                     section_start, section_end, len(spliced))

            # read fresh disk original for the diff — this is always the true before state
            try:
                original = rag.read_file_from_scope(scope_for_file, file_path)
            except Exception:
                original = disk_content

            yield "__STAGE__done"

            filename = file_path.split("/")[-1]
            yield f"Expanding **{filename}**…"

            sentinel = json.dumps({
                "type": "file_edit",
                "scope": scope_for_file,
                "path": file_path,
                "original": original,
                "new": spliced,
            })
            yield f"\n\n__SHRIMP_EDIT__{sentinel}"

        async def stream_file_edit():
            # Stage tokens for pre-stream steps (already completed by this point)
            yield "__STAGE__finding"
            yield "__STAGE__reading"
            async for chunk in stream_file_edit_inner():
                yield chunk

        return StreamingResponse(stream_file_edit(), media_type="text/plain")

    # ── step 3b: normal chat path ─────────────────────────────────────────────
    system_prompt = (
        "You are SHRIMP*, a local AI coding assistant with access to the user's files.\n\n"
        "## Your Role\n"
        "You're a collaborative coding assistant that helps users understand and modify their codebase. "
        "You can read files, answer questions, explain implementations, AND propose file edits that "
        "users can review in a diff viewer before applying.\n\n"
        "## When Users Ask Questions\n"
        "When users ask \"how would I do X?\" or \"what's the best way to implement Y?\":\n"
        "1. **Explain the approach** — provide implementation guidance, architectural suggestions, code examples\n"
        "2. **Offer to help** — after explaining, you can offer: \"Would you like me to implement this for you?\"\n"
        "3. **Don't make unsolicited changes** — if they're asking for explanation, give explanation first\n\n"
        "## When Users Request Changes\n"
        "When users ask you to \"add X\", \"update Y\", \"fix Z\", or \"implement A\":\n"
        "- They want you to actually make the changes (not just explain)\n"
        "- However, you're currently in QUESTION-ANSWERING mode\n"
        "- Explain what you would change and WHY\n"
        "- Then suggest: \"To make these changes, send a direct edit request like 'update [filename] to do [specific change]'\"\n\n"
        "## Key Principles\n"
        "- **Be helpful, not presumptuous** — explain first, act second\n"
        "- **Clarify ambiguity** — if unsure whether they want explanation or action, ask\n"
        "- **Don't hallucinate capabilities** — you can propose file edits, but only ONE file at a time currently\n"
        "- **Be specific** — when suggesting changes, reference exact file paths and line numbers\n\n"
        "## Formatting\n"
        "Respond using markdown formatting — use headers, bold, italics, lists, and "
        "code blocks where appropriate. "
        "IMPORTANT: Never wrap your entire response in a ```markdown code fence. "
        "Write markdown directly — your output is rendered in a markdown-aware chat UI. "
        "Only use fenced code blocks (``` with a language tag) for actual code snippets "
        "like Python, TypeScript, bash, etc."
    )

    augmented_message = f"Here is a map of all files you have access to:\n\n{file_tree}\n\n"
    if context:
        augmented_message += f"Here is relevant file content:\n\n{context}\n\n"
    augmented_message += f"Now answer this question:\n{req.message}"

    messages = [
        {"role": "system", "content": system_prompt},
        *req.history,
        {"role": "user", "content": augmented_message},
    ]

    log.info("chat: normal chat — scopes=%s needs_files=%s",
             scope_names, needs_files)

    async def stream_inner():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                f"{config.OLLAMA_HOST}/api/chat",
                json={
                    "model": config.OLLAMA_MODEL,
                    "messages": messages,
                    "stream": True,
                    "options": {"num_ctx": config.NUM_CTX},
                },
            ) as resp:
                async for line in resp.aiter_lines():
                    if await request.is_disconnected():
                        log.info("chat: client disconnected during stream")
                        return
                    if line:
                        data = json.loads(line)
                        if token := data.get("message", {}).get("content"):
                            yield token
                        if data.get("done"):
                            break

    async def stream():
        # Stage token for file selection (already completed by this point)
        yield "__STAGE__searching"
        # Stage token before Ollama call
        yield "__STAGE__thinking"
        async for chunk in stream_inner():
            yield chunk

    return StreamingResponse(stream(), media_type="text/plain")


# ── routes: scopes ────────────────────────────────────────────────────────────


@app.get("/scopes", response_model=list[Scope])
async def get_scopes():
    return config.WATCHED_DIRS


@app.get("/settings/scopes", response_model=list[Scope])
async def get_scopes_settings():
    return config.WATCHED_DIRS


@app.post("/settings/scopes")
async def set_scopes(update: ScopeUpdate):
    config.WATCHED_DIRS = update.scopes
    write_config(config.WATCHED_DIRS, config.OLLAMA_MODEL)
    return config.WATCHED_DIRS


@app.delete("/settings/scopes/{name}")
async def delete_scope(name: str):
    config.WATCHED_DIRS = [s for s in config.WATCHED_DIRS if s["name"] != name]
    write_config(config.WATCHED_DIRS, config.OLLAMA_MODEL)
    return config.WATCHED_DIRS


# ── routes: models ────────────────────────────────────────────────────────────


@app.get("/models")
async def get_models():
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(f"{config.OLLAMA_HOST}/api/tags")
        data = resp.json()
        return {
            "models": [m["name"] for m in data.get("models", [])],
            "active": config.OLLAMA_MODEL,
        }


@app.post("/settings/model")
async def set_model(update: ModelUpdate):
    config.OLLAMA_MODEL = update.model
    rag.Settings.llm = __import__('llama_index.llms.ollama', fromlist=['Ollama']).Ollama(
        model=update.model, request_timeout=120.0
    )
    write_config(config.WATCHED_DIRS, config.OLLAMA_MODEL)
    return {"active": config.OLLAMA_MODEL}


@app.post("/models/pull")
async def pull_model(body: dict):
    model = body["model"]

    async def stream():
        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream(
                "POST",
                f"{config.OLLAMA_HOST}/api/pull",
                json={"name": model}
            ) as r:
                async for line in r.aiter_lines():
                    if line:
                        yield line + "\n"
    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.delete("/models/{model:path}")
async def delete_model(model: str):
    async with httpx.AsyncClient() as client:
        await client.delete(
            f"{config.OLLAMA_HOST}/api/delete",
            json={"name": model}
        )
    return {"ok": True}


# ── routes: indexing ──────────────────────────────────────────────────────────


@app.post("/index")
async def index_all():
    log.info("index_all: triggered")

    def run():
        rag.build_all_indexes()
    threading.Thread(target=run, daemon=True).start()
    return {"status": "indexing started"}


@app.get("/index/status")
async def index_status():
    return rag.get_status()


@app.post("/index/structural")
async def refresh_structural():
    def run():
        for scope in config.WATCHED_DIRS:
            if scope.get("enabled"):
                rag.build_structural_map(scope)
    threading.Thread(target=run, daemon=True).start()
    return {"status": "structural map refresh started"}


@app.post("/index/{name}")
async def index_one(name: str):
    scope = next((s for s in config.WATCHED_DIRS if s["name"] == name), None)
    if not scope:
        raise HTTPException(
            status_code=404, detail=f"Scope '{name}' not found")

    def run():
        rag.build_index(scope)
    threading.Thread(target=run, daemon=True).start()
    return {"status": "indexing started", "scope": name}


@app.get("/index/{name}/stream")
async def index_stream(name: str):
    scope = next((s for s in config.WATCHED_DIRS if s["name"] == name), None)
    if not scope:
        raise HTTPException(
            status_code=404, detail=f"Scope '{name}' not found")

    q: queue.Queue = queue.Queue()

    def callback(current: int, total: int, filename: str):
        q.put({"current": current, "total": total,
               "file": filename, "done": False})

    def run_index():
        try:
            rag.build_index(scope, progress_callback=callback)
        except Exception as e:
            q.put({"error": str(e), "done": True})
        finally:
            q.put({"done": True})

    threading.Thread(target=run_index, daemon=True).start()

    async def event_generator():
        while True:
            try:
                event = q.get(timeout=0.1)
                yield {"data": json.dumps(event)}
                if event.get("done"):
                    break
            except queue.Empty:
                yield {"data": json.dumps({"ping": True})}
            await asyncio.sleep(0.05)

    return EventSourceResponse(event_generator())


# ── routes: file reading (diff support) ──────────────────────────────────────


@app.get("/file")
async def read_file(scope: str, path: str):
    try:
        content = rag.read_file_from_scope(scope, path)
        return {"scope": scope, "path": path, "content": content}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=413, detail=str(e))


@app.post("/file/apply")
async def apply_edit(req: ApplyEditRequest):
    try:
        root = Path(next(
            (s["path"]
             for s in config.WATCHED_DIRS if s["name"] == req.scope), ""
        )).expanduser().resolve()

        if not root:
            raise HTTPException(
                status_code=404, detail=f"Scope '{req.scope}' not found")

        target = (root / req.path).resolve()

        if not str(target).startswith(str(root)):
            raise HTTPException(
                status_code=403, detail="Path escapes scope root")

        target.write_text(req.content, encoding="utf-8")
        log.info("apply_edit: wrote %s / %s", req.scope, req.path)

        scope = next(
            (s for s in config.WATCHED_DIRS if s["name"] == req.scope), None)
        if scope:
            await asyncio.get_event_loop().run_in_executor(
                None, rag.build_structural_map, scope
            )

        return {"scope": req.scope, "path": req.path, "status": "applied"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ── routes: ctx ────────────────────────────────────────────────

@app.get("/settings/ctx")
async def get_ctx():
    return {"num_ctx": config.NUM_CTX}

@app.post("/settings/ctx")
async def set_ctx_setting(update: CtxUpdate):
    config.NUM_CTX = update.num_ctx
    # persist to config.py
    config_path = Path(__file__).parent / "config.py"
    current = config_path.read_text()
    import re as _re
    if _re.search(r"NUM_CTX: int = \d+", current):
        current = _re.sub(r"NUM_CTX: int = \d+", f"NUM_CTX: int = {update.num_ctx}", current)
        config_path.write_text(current)
        log.info("settings: NUM_CTX set to %d", update.num_ctx)
        return {"num_ctx": config.NUM_CTX}
