import config
import chromadb
import logging
from pathlib import Path
from datetime import datetime

from llama_index.core import (
    VectorStoreIndex,
    SimpleDirectoryReader,
    StorageContext,
    Settings,
)
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.vector_stores.chroma import ChromaVectorStore

log = logging.getLogger("shrimp.rag")

# ── llama index globals ────────────────────────────────────────────────────────

log.info("Initialising LlamaIndex — LLM: %s  embed: %s", config.OLLAMA_MODEL, config.EMBED_MODEL)
Settings.llm = Ollama(model=config.OLLAMA_MODEL, request_timeout=120.0)
Settings.embed_model = OllamaEmbedding(model_name=config.EMBED_MODEL)

chroma_client = chromadb.PersistentClient(path=config.CHROMA_PATH)
log.info("ChromaDB client ready at %s", config.CHROMA_PATH)

# tracks last index time and file count per scope
index_status: dict[str, dict] = {}

SUPPORTED_EXTENSIONS = [
    ".md", ".py", ".ts", ".tsx", ".js", ".jsx",
    ".json", ".yaml", ".yml", ".toml", ".txt", ".env.example"
]

# ── index management ───────────────────────────────────────────────────────────


def get_index(collection_name: str) -> VectorStoreIndex | None:
    """Load an existing index from Chroma, or return None if not yet indexed."""
    try:
        collection = chroma_client.get_collection(collection_name)
        vector_store = ChromaVectorStore(chroma_collection=collection)
        storage_context = StorageContext.from_defaults(
            vector_store=vector_store)
        index = VectorStoreIndex.from_vector_store(vector_store, storage_context=storage_context)
        log.debug("get_index(%s): loaded from Chroma", collection_name)
        return index
    except Exception:
        log.debug("get_index(%s): not found in Chroma", collection_name)
        return None


def build_index(scope: dict) -> dict:
    """
    Index a directory into a named Chroma collection.
    Deletes and rebuilds the collection if it already exists.
    Returns status info.
    """
    name = scope["name"]
    path = str(Path(scope["path"]).expanduser())

    log.info("[%s] Starting index of %s", name, path)

    if not Path(path).exists():
        log.error("[%s] Directory not found: %s", name, path)
        raise FileNotFoundError(f"Directory not found: {path}")

    # drop and recreate collection for a clean re-index
    try:
        chroma_client.delete_collection(name)
        log.debug("[%s] Dropped existing Chroma collection", name)
    except Exception:
        pass

    collection = chroma_client.get_or_create_collection(name)
    vector_store = ChromaVectorStore(chroma_collection=collection)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    docs = SimpleDirectoryReader(
        path,
        recursive=True,
        required_exts=SUPPORTED_EXTENSIONS,
    ).load_data()

    if not docs:
        log.warning("[%s] No supported files found in %s — skipping index", name, path)
        status = {
            "name": name,
            "path": path,
            "file_count": 0,
            "last_indexed": datetime.now().isoformat(),
        }
        index_status[name] = status
        return status

    log.info("[%s] Loaded %d documents, embedding...", name, len(docs))

    VectorStoreIndex.from_documents(
        docs,
        storage_context=storage_context,
        show_progress=False,
    )

    status = {
        "name": name,
        "path": path,
        "file_count": len(docs),
        "last_indexed": datetime.now().isoformat(),
    }
    index_status[name] = status
    log.info("[%s] Index complete — %d docs stored", name, len(docs))
    return status


def build_all_indexes() -> list[dict]:
    """Index all enabled scopes."""
    enabled = [s for s in config.WATCHED_DIRS if s.get("enabled")]
    log.info("build_all_indexes: %d enabled scope(s): %s", len(enabled), [s["name"] for s in enabled])
    results = []
    for scope in enabled:
        try:
            results.append(build_index(scope))
        except Exception as e:
            log.error("[%s] Index failed: %s", scope["name"], e)
            results.append({"name": scope["name"], "error": str(e)})
    return results

# ── querying ───────────────────────────────────────────────────────────────────


def query_scopes(question: str, scope_names: list[str]) -> str:
    """
    Query one or more scope indexes and return combined context
    as a string to inject into the chat prompt.
    """
    log.info("query_scopes: scopes=%s  question=%r", scope_names, question[:80])
    context_chunks = []

    for name in scope_names:
        index = get_index(name)
        if index is None:
            log.warning("[%s] Not indexed yet — skipping RAG retrieval", name)
            context_chunks.append(f"[scope '{name}' has not been indexed yet]")
            continue

        retriever = index.as_retriever(similarity_top_k=5)
        nodes = retriever.retrieve(question)

        if not nodes:
            log.info("[%s] No relevant nodes found for query", name)
            continue

        log.info("[%s] Retrieved %d node(s)", name, len(nodes))
        context_chunks.append(f"--- context from scope: {name} ---")
        for node in nodes:
            source = node.metadata.get("file_path", "unknown file")
            context_chunks.append(f"# {source}\n{node.text}")

    return "\n\n".join(context_chunks)


def get_status() -> list[dict]:
    """Return index status for all configured scopes."""
    result = []
    for scope in config.WATCHED_DIRS:
        name = scope["name"]
        if name in index_status:
            result.append(index_status[name])
        else:
            result.append({
                "name": name,
                "path": scope["path"],
                "file_count": None,
                "last_indexed": None,
            })
    return result
