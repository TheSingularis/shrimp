from fastapi import FastAPI, HTTPException
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


class Scope(BaseModel):
    name: str
    path: str
    enabled: bool


class ScopeUpdate(BaseModel):
    scopes: list[dict]


class ModelUpdate(BaseModel):
    model: str

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

# ── routes: health ────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {"status": "ok", "model": config.OLLAMA_MODEL}


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

# ── routes: chat ──────────────────────────────────────────────────────────────


@app.post("/chat")
async def chat(req: ChatRequest):
    enabled = [s for s in config.WATCHED_DIRS if s["enabled"]]
    active = [s for s in enabled if s["name"]
              in req.scopes] if req.scopes else enabled

    if not active:
        raise HTTPException(
            status_code=400, detail="No active scopes selected")

    scope_names = [s["name"] for s in active]
    log.info("chat: scopes=%s  message=%r", scope_names, req.message[:80])
    file_tree = rag.get_structural_summary(scope_names, max_files=150)

    # ── step 1: ask LLM if it needs specific files ────────────────────────────
    file_selection_prompt = (
        "You are a file selection assistant. Given a file tree and a user question, "
        "decide if answering the question requires reading specific files.\n\n"
        "Rules:\n"
        "- If the question is conversational, general, or doesn't need file content, "
        'respond with: {"needs_files": false}\n'
        "- If specific files would help, respond with the most relevant file paths. "
        'Example: {"needs_files": true, "files": {"code": ["src/main.py"], "obsidian": ["Notes/auth.md"]}}\n'
        "- Only include files that actually exist in the tree below.\n"
        "- Maximum 5 files total across all scopes.\n"
        "- Respond with JSON only. No explanation, no markdown.\n\n"
        f"FILE TREE:\n{file_tree}\n\n"
        f"USER QUESTION: {req.message}"
    )

    selected_files: dict[str, list[str]] = {}
    needs_files = False

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{config.OLLAMA_HOST}/api/chat",
                json={
                    "model": config.OLLAMA_MODEL,
                    "messages": [{"role": "user", "content": file_selection_prompt}],
                    "stream": False,
                    "format": "json",
                },
            )
            raw = resp.json().get("message", {}).get("content", "{}")
            parsed = json.loads(raw)
            needs_files = parsed.get("needs_files", False)
            if needs_files:
                selected_files = parsed.get("files", {})
                log.info("chat: file selection — %s", selected_files)
            else:
                log.info("chat: LLM decided no files needed")
    except Exception as e:
        log.warning(
            "chat: file selection pass failed (%s) — falling back to vector index", e)

    # ── step 2: gather context ────────────────────────────────────────────────
    context_chunks = []

    if needs_files and selected_files:
        for scope_name, paths in selected_files.items():
            if not paths:
                continue
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

    # ── step 3: build final prompt and stream answer ──────────────────────────
    system_prompt = (
        "You are SHRIMP*, a local AI assistant with access to the user's files. "
        "When proposing file edits, always specify the full file path and provide "
        "the complete new file content inside a fenced code block."
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

    log.info("chat: streaming response — scopes=%s needs_files=%s",
             scope_names, needs_files)

    async def stream():
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{config.OLLAMA_HOST}/api/chat",
                json={"model": config.OLLAMA_MODEL,
                      "messages": messages, "stream": True},
            ) as resp:
                async for line in resp.aiter_lines():
                    if line:
                        data = json.loads(line)
                        if token := data.get("message", {}).get("content"):
                            yield token
                        if data.get("done"):
                            break

    return StreamingResponse(stream(), media_type="text/plain")

# ── startup ────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    log.info("Server process startup - hydrating state...")
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, rag._hydrate_status)
    await loop.run_in_executor(None, rag.build_all_structural_maps)
    log.info("Startup complete - structural maps and index status ready")

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

# ── routes: indexing ──────────────────────────────────────────────────────────


@app.get("/index/status")
async def index_status():
    return rag.get_status()


@app.post("/index")
async def index_all():
    log.info("index_all: triggered")

    def run():
        rag.build_all_indexes()
    threading.Thread(target=run, daemon=True).start()
    return {"status": "indexing started"}


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


@app.post("/index/structural")
async def refresh_structural():
    def run():
        for scope in config.WATCHED_DIRS:
            if scope.get("enabled"):
                rag.build_structural_map(scope)
    threading.Thread(target=run, daemon=True).start()
    return {"status": "structural map refresh started"}
