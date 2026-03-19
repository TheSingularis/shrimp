from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from pathlib import Path
import httpx
import json
import logging
import re
import asyncio
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
    log.info("config.py written: model=%s  scopes=%s", model, [s["name"] for s in scopes])

# ── routes: health ────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {"status": "ok", "model": config.OLLAMA_MODEL}

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

    # retrieve context from RAG indexes
    context = await asyncio.get_event_loop().run_in_executor(
        None, rag.query_scopes, req.message, scope_names
    )

    # build prompt with injected context
    system_prompt = (
        "You are SHRIMP*, a local AI assistant with access to the user's files. "
        "Answer using the provided file context where relevant. "
        "When proposing file edits, always specify the full file path and provide "
        "the complete new file content inside a fenced code block.\n\n"
        f"FILE CONTEXT:\n{context}"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        *req.history,
        {"role": "user", "content": req.message},
    ]

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


@app.post("/index")
async def index_all():
    """Trigger a full re-index of all enabled scopes. Runs in background."""
    log.info("index_all: triggered")
    async def run():
        try:
            await asyncio.get_event_loop().run_in_executor(None, rag.build_all_indexes)
        except Exception as e:
            log.exception("index_all: background task failed: %s", e)

    asyncio.create_task(run())
    return {"status": "indexing started"}


@app.post("/index/{name}")
async def index_one(name: str):
    """Trigger re-index of a single scope by name."""
    scope = next((s for s in config.WATCHED_DIRS if s["name"] == name), None)
    if not scope:
        raise HTTPException(
            status_code=404, detail=f"Scope '{name}' not found")

    log.info("index_one: scope=%s  path=%s", name, scope["path"])
    async def run():
        try:
            await asyncio.get_event_loop().run_in_executor(None, rag.build_index, scope)
        except Exception as e:
            log.exception("index_one[%s]: background task failed: %s", name, e)

    asyncio.create_task(run())
    return {"status": "indexing started", "scope": name}


@app.get("/index/status")
async def index_status():
    return rag.get_status()
