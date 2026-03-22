from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.embeddings.ollama import OllamaEmbedding
from llama_index.llms.ollama import Ollama
from llama_index.core import (
    VectorStoreIndex,
    SimpleDirectoryReader,
    StorageContext,
    Settings,
)
from llama_index.core.node_parser import SentenceSplitter
import config
import chromadb
import logging
from pathlib import Path
from datetime import datetime

# llama_index emits this warning once per file when llama-index-readers-file is
# not installed — it's harmless (SimpleDirectoryReader falls back gracefully)
# but floods the log. Suppress it at the source.
logging.getLogger("llama_index.core.readers.file.base").setLevel(logging.ERROR)


log = logging.getLogger("shrimp.rag")

# ── llama index globals ────────────────────────────────────────────────────────

log.info("Initialising LlamaIndex — LLM: %s  embed: %s",
         config.OLLAMA_MODEL, config.EMBED_MODEL)
Settings.llm = Ollama(model=config.OLLAMA_MODEL, request_timeout=120.0)
Settings.embed_model = OllamaEmbedding(model_name=config.EMBED_MODEL)
Settings.transformations = [SentenceSplitter(chunk_size=512, chunk_overlap=50)]

chroma_client = chromadb.PersistentClient(path=config.CHROMA_PATH)
log.info("ChromaDB client ready at %s", config.CHROMA_PATH)

# ── constants ──────────────────────────────────────────────────────────────────

SUPPORTED_EXTENSIONS = [
    ".md", ".py", ".ts", ".tsx", ".js", ".jsx",
    ".json", ".yaml", ".yml", ".toml", ".txt",
    ".env.example", ".sh", ".rs", ".go", ".java", ".c", ".cpp", ".h",
]

EXCLUDED_DIRS = {
    # deps
    "node_modules", ".pnp", ".yarn",
    # python
    ".venv", "venv", "__pycache__", ".mypy_cache",
    ".pytest_cache", ".ruff_cache", ".tox", "*.egg-info",
    # build output
    "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
    "target", ".gradle",
    # vcs / editors
    ".git", ".idea", ".vscode",
    # shrimp own dirs
    "chroma_db", ".ollama",
    # test coverage
    "coverage", ".nyc_output",
    # os
    ".DS_Store", "Thumbs.db",
}

MAX_FILE_BYTES = 500 * 1024  # 500 KB — skip binary/generated files

# ── runtime state ──────────────────────────────────────────────────────────────

index_status: dict[str, dict] = {}
index_progress: dict[str, dict] = {}
structural_maps: dict[str, list[dict]] = {}

# ── startup ────────────────────────────────────────────────────────────────────


def _hydrate_status() -> None:
    """
    Populate index_status from existing ChromaDB collections on startup.
    Survives uvicorn --reload restarts where in-memory state is lost.
    """
    scope_map = {s["name"]: s for s in config.WATCHED_DIRS}
    try:
        for col in chroma_client.list_collections():
            name = col.name
            if name not in scope_map:
                continue
            count = col.count()
            path = str(Path(scope_map[name]["path"]).expanduser())
            index_status[name] = {
                "name": name,
                "path": path,
                "file_count": count,
                "last_indexed": "(restored)",
            }
            log.info("[%s] Restored status from ChromaDB: %d docs", name, count)
    except Exception:
        log.exception("Failed to hydrate index status from ChromaDB")


def build_structural_map(scope: dict) -> list[dict]:
    """
    Fast first pass — walk the directory and collect file metadata + preview.
    No embedding. Runs in seconds even on large repos.
    """
    name = scope["name"]
    path = Path(scope["path"]).expanduser()

    if not path.exists():
        log.warning("[%s] structural map: path not found: %s", name, path)
        return []

    files = []
    for f in sorted(path.rglob("*")):
        if not f.is_file():
            continue
        if f.suffix not in SUPPORTED_EXTENSIONS:
            continue
        if f.stat().st_size > MAX_FILE_BYTES:
            continue
        if any(ex in f.parts for ex in EXCLUDED_DIRS):
            continue
        try:
            preview = f.read_text(errors="ignore")[:300].strip()
        except Exception:
            preview = ""
        files.append({
            "path": str(f.relative_to(path)),
            "size": f.stat().st_size,
            "modified": f.stat().st_mtime,
            "preview": preview,
        })

    structural_maps[name] = files
    log.info("[%s] Structural map built: %d files", name, len(files))
    return files


def build_all_structural_maps() -> None:
    """Build structural maps for all enabled scopes. Called on startup."""
    for scope in config.WATCHED_DIRS:
        if scope.get("enabled"):
            build_structural_map(scope)


def get_structural_summary(scope_names: list[str], max_files: int = 150) -> str:
    """
    Render a compact file tree string for injection into the chat system prompt.
    Truncates to max_files to avoid blowing the context window.
    """
    lines = []
    for name in scope_names:
        files = structural_maps.get(name, [])
        if not files:
            lines.append(
                f"[scope '{name}': no structural map yet — run index first]")
            continue
        lines.append(f"--- scope: {name} ({len(files)} files total) ---")
        for f in files[:max_files]:
            lines.append(f["path"])
        if len(files) > max_files:
            lines.append(
                f"... and {len(files) - max_files} more files not shown")
    return "\n".join(lines)


# ── index management ───────────────────────────────────────────────────────────


def get_index(collection_name: str) -> VectorStoreIndex | None:
    """Load an existing index from Chroma, or return None if not yet indexed."""
    try:
        collection = chroma_client.get_collection(collection_name)
        vector_store = ChromaVectorStore(chroma_collection=collection)
        storage_context = StorageContext.from_defaults(
            vector_store=vector_store)
        index = VectorStoreIndex.from_vector_store(
            vector_store, storage_context=storage_context)
        log.debug("get_index(%s): loaded from Chroma", collection_name)
        return index
    except Exception:
        log.debug("get_index(%s): not found in Chroma", collection_name)
        return None


def build_index(scope: dict, progress_callback=None) -> dict:
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

    try:
        chroma_client.delete_collection(name)
        log.debug("[%s] Dropped existing Chroma collection", name)
    except Exception:
        pass

    collection = chroma_client.get_or_create_collection(name)
    vector_store = ChromaVectorStore(chroma_collection=collection)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    exclude_paths = [
        str(Path(path) / d)
        for d in EXCLUDED_DIRS
        if (Path(path) / d).exists()
    ]
    if exclude_paths:
        log.info("[%s] Excluding %d dirs: %s", name,
                 len(exclude_paths), [Path(p).name for p in exclude_paths])

    docs = SimpleDirectoryReader(
        path,
        recursive=True,
        required_exts=SUPPORTED_EXTENSIONS,
        exclude=exclude_paths,
        file_metadata=lambda fp: {"file_path": fp},
    ).load_data()

    before = len(docs)
    docs = [
        d for d in docs
        if Path(d.metadata.get("file_path", "")).stat().st_size <= MAX_FILE_BYTES
    ]
    dropped = before - len(docs)
    if dropped:
        log.info("[%s] Dropped %d oversized file(s)", name, dropped)

    if not docs:
        log.warning(
            "[%s] No supported files found in %s — skipping index", name, path)
        status = {
            "name": name,
            "path": path,
            "file_count": 0,
            "last_indexed": datetime.utcnow().isoformat() + "Z",
        }
        index_status[name] = status
        return status

    total = len(docs)
    log.info("[%s] Loaded %d documents, embedding...", name, total)

    for i, doc in enumerate(docs):
        VectorStoreIndex.from_documents(
            [doc],
            storage_context=storage_context,
            show_progress=False,
        )
        filename = Path(doc.metadata.get("file_path", "")).name
        index_progress[name] = {"current": i +
                                1, "total": total, "file": filename}
        if progress_callback:
            progress_callback(i + 1, total, filename)

    index_progress.pop(name, None)

    status = {
        "name": name,
        "path": path,
        "file_count": total,
        "last_indexed": datetime.utcnow().isoformat() + "Z",
    }
    index_status[name] = status
    log.info("[%s] Index complete — %d docs stored", name, total)
    return status


def build_all_indexes() -> list[dict]:
    """Index all enabled scopes."""
    enabled = [s for s in config.WATCHED_DIRS if s.get("enabled")]
    log.info("build_all_indexes: %d enabled scope(s): %s",
             len(enabled), [s["name"] for s in enabled])
    results = []
    for scope in enabled:
        try:
            results.append(build_index(scope))
        except Exception as e:
            log.error("[%s] Index failed: %s", scope["name"], e)
            results.append({"name": scope["name"], "error": str(e)})
    return results

# ── on-demand embedding ────────────────────────────────────────────────────────


def embed_files_on_demand(scope_name: str, file_paths: list[str]) -> VectorStoreIndex | None:
    """
    Embed a specific list of files into a temporary in-memory index.
    Always re-embeds for freshness — does not touch the persistent Chroma index.
    Returns a queryable index or None if no files could be read.
    """
    root = Path(next(
        (s["path"] for s in config.WATCHED_DIRS if s["name"] == scope_name), ""
    )).expanduser()

    resolved = []
    for p in file_paths:
        candidate = Path(p) if Path(p).is_absolute() else root / p
        if not candidate.exists():
            log.warning(
                "[%s] on-demand: file not found, skipping: %s", scope_name, p)
            continue
        if candidate.stat().st_size > MAX_FILE_BYTES:
            log.warning(
                "[%s] on-demand: file too large, skipping: %s", scope_name, p)
            continue
        resolved.append(str(candidate))

    if not resolved:
        log.warning("[%s] on-demand: no valid files to embed", scope_name)
        return None

    log.info("[%s] on-demand: embedding %d file(s): %s",
             scope_name, len(resolved), [Path(p).name for p in resolved])

    try:
        docs = SimpleDirectoryReader(
            input_files=resolved,
            file_metadata=lambda fp: {"file_path": fp},
        ).load_data()

        if not docs:
            log.warning(
                "[%s] on-demand: no content loaded from files", scope_name)
            return None

        index = VectorStoreIndex.from_documents(docs, show_progress=False)
        log.info("[%s] on-demand: index built with %d doc(s)",
                 scope_name, len(docs))
        return index

    except Exception as e:
        log.error("[%s] on-demand: embedding failed: %s", scope_name, e)
        return None


def query_on_demand(question: str, scope_name: str, file_paths: list[str]) -> str:
    """
    Embed the given files on demand and query them.
    Returns context string for prompt injection.
    """
    index = embed_files_on_demand(scope_name, file_paths)
    if index is None:
        return f"[on-demand: could not read files for scope '{scope_name}']"

    retriever = index.as_retriever(similarity_top_k=5)
    nodes = retriever.retrieve(question)

    if not nodes:
        log.info("[%s] on-demand: no relevant nodes found", scope_name)
        return ""

    log.info("[%s] on-demand: retrieved %d node(s)", scope_name, len(nodes))
    chunks = [f"--- on-demand context from scope: {scope_name} ---"]
    for node in nodes:
        source = node.metadata.get("file_path", "unknown")
        chunks.append(f"# {source}\n{node.text}")

    return "\n\n".join(chunks)

# ── querying ───────────────────────────────────────────────────────────────────


def query_scopes(question: str, scope_names: list[str]) -> str:
    """
    Query pre-built vector indexes and return combined context.
    Used as fallback when LLM decides no specific files are needed.
    """
    log.info("query_scopes: scopes=%s  question=%r",
             scope_names, question[:80])
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
        entry = {
            "name": name,
            "path": scope["path"],
            "file_count": None,
            "last_indexed": None,
            "indexing": None,
        }
        if name in index_status:
            entry.update(index_status[name])
        if name in index_progress:
            entry["indexing"] = index_progress[name]
        result.append(entry)
    return result

# ── file reading ───────────────────────────────────────────────────────────────

def read_file_from_scope(scope_name: str, relative_path: str) -> str:
    """
    Read a file from a scope by its relative path and return its raw text.
    Used by the diff endpoint to supply the 'before' side of a diff view.
    Raises FileNotFoundError if the scope of file does't exist.
    """
    scope = next(
        (s for s in config.WATCHED_DIRS if s["name"] == scope_name), None
    )
    if scope is None:
        raise FileNotFoundError(f"Scope '{scope_name}' not found")

    root = Path(scope["path"]).expanduser().resolve()
    target = (root / relative_path).resolve()

    # Prevent path traversal outside the scope root
    if not str(target).startswith(str(root)):
        raise PermissionError(f"Path '{relative_path}' escapes scope root")

    if not target.exists():
        raise FileNotFoundError(f"File not found: {relative_path}")

    if target.stat().st_size > MAX_FILE_BYTES:
        raise ValueError(f"File too large to read: {relative_path}")

    log.info("[%s] read_file_from_scope: %s", scope_name, relative_path)
    return target.read_text(errors="ignore")

# ── fuzzy file resolution ──────────────────────────────────────────────────────────

def find_file_in_scopes(filename: str, scope_names: list[str]) -> list[dict]:
    """
    Search structural maps for files whose path ends with the given filename.
    Match is case-insensitive and works with partial paths too.

    e.g. "Tyr.md" matches "DND - Storm Kings Thunder/Characters/NPCs/Tyr.md"
    e.g. "NPCs/Tyr.md" also matches the same file

    Returns a list of dicts: [{"scope": name, "path": relative_path}, ...]
    Sorted by path length ascending so the most specific match comes first.
    """
    needle = filename.lower().replace("\\", "/")
    matches = []

    for name in scope_names:
        files = structural_maps.get(name, [])
        for f in files:
            haystack = f["path"].lower().replace("\\", "/")
            if haystack.endswith(needle):
                matches.append({"scope": name, "path": f["path"]})

    # shortest path = most specific match (least extra directories)
    matches.sort(key=lambda m: len(m["path"]))
    log.info("find_file_in_scopes(%r, %s): %d match(es)", filename, scope_names, len(matches))
    return matches
