from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import httpx, json
import config

app = FastAPI(title="SHRIMP*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# --- models ---

class ChatRequest(BaseModel):
    message: str
    scopes: list[str] = []
    history: list[dict] = []

class Scope(BaseModel):
    name: str
    path: str
    enabled: bool

# --- routes ---

@app.get("/health")
async def health():
    return {"status": "ok", "model": config.OLLAMA_MODEL}

@app.get("/scopes", response_model=list[Scope])
async def get_scopes():
    """Return all configured scopes. Frontend uses this to populate the scope selection UI."""
    return config.WATCHED_DIRS

@app.post("/chat")
async def chat(req: ChatRequest):
    # resolve which scopes are active for this request
    enabled = [s for s in config.WATCHED_DIRS if s["enabled"]]
    if req.scopes:
        active = [s for s in enabled if s["name"] in req.scopes]
    else:
        active = enabled

    if not active: raise HTTPException(status_code=400, detail="No active scopes selected")

    # placeholder -- Phase 5 will implement RAG context here per active scope
    scope_note = f"[scopes: {', '.join(s['name'] for s in active)}]"
    messages = req.history + [{"role": "system", "content": f"{scope_note}\n\n{req.message}"}]

    async def stream():
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{config.OLLAMA_HOST}/api/chat",
                json={"model": config.OLLAMA_MODEL, "messages": messages, "stream": True},
            ) as resp: 
                async for line in resp.aiter_lines():
                    if line:
                        data = json.loads(line)
                        if token := data.get("message", {}).get("content"):
                            yield token
                        if data.get("done"):
                            break

    return StreamingResponse(stream(), media_type="text/plain")
