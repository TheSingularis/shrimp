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
from config_utils import get_data_dir
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

_chroma_path = config.CHROMA_PATH
if not Path(_chroma_path).is_absolute():
    _chroma_path = str(get_data_dir() / _chroma_path)
chroma_client = chromadb.PersistentClient(path=_chroma_path)
log.info("ChromaDB client ready at %s", _chroma_path)

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
    # Create reverse mapping from sanitized collection name to original scope
    sanitized_to_scope = {
        sanitize_collection_name(s["name"]): s for s in config.WATCHED_DIRS
    }
    try:
        for col in chroma_client.list_collections():
            collection_name = col.name
            if collection_name not in sanitized_to_scope:
                continue
            scope = sanitized_to_scope[collection_name]
            name = scope["name"]
            count = col.count()
            path = str(Path(scope["path"]).expanduser())
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
    Render file tree grouped by directory for better context.
    Shows directory hierarchy to help LLM understand structure.
    Truncates to max_files to avoid blowing the context window.
    """
    lines = []
    for name in scope_names:
        files = structural_maps.get(name, [])
        if not files:
            lines.append(
                f"[scope '{name}': no structural map yet — run index first]")
            continue

        lines.append(f"=== Scope: {name} ({len(files)} files) ===")

        # Group files by top-level directory
        by_dir: dict[str, list[str]] = {}
        for f in files[:max_files]:
            parts = f["path"].split("/", 1)
            top_dir = parts[0] if len(parts) > 1 else "(root)"
            if top_dir not in by_dir:
                by_dir[top_dir] = []
            by_dir[top_dir].append(f["path"])

        # Render grouped by directory
        for dir_name in sorted(by_dir.keys()):
            paths = by_dir[dir_name]
            lines.append(f"\n{dir_name}/")
            for path in sorted(paths):
                lines.append(f"  {path}")

        if len(files) > max_files:
            lines.append(
                f"\n... and {len(files) - max_files} more files not shown")
        lines.append("")

    return "\n".join(lines)


# ── helpers ────────────────────────────────────────────────────────────────────


def sanitize_collection_name(name: str) -> str:
    """
    Sanitize scope name for use as ChromaDB collection name.
    ChromaDB requires collection names to:
    - Start and end with alphanumeric characters
    - Contain only alphanumerics, underscores, and hyphens
    - Be between 3-63 characters
    """
    # Replace spaces and invalid characters with underscores
    sanitized = name.replace(" ", "_")
    # Remove any remaining invalid characters
    sanitized = "".join(c if c.isalnum() or c in "_-" else "_" for c in sanitized)
    # Ensure it starts with alphanumeric
    sanitized = sanitized.lstrip("_-")
    # Ensure it ends with alphanumeric
    sanitized = sanitized.rstrip("_-")
    # Ensure minimum length
    if len(sanitized) < 3:
        sanitized = f"scope_{sanitized}"
    return sanitized


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
    collection_name = sanitize_collection_name(name)
    root = Path(scope["path"]).expanduser()

    log.info("[%s] Starting index of %s (collection: %s)", name, root, collection_name)

    if not root.exists():
        log.error("[%s] Directory not found: %s", name, root)
        raise FileNotFoundError(f"Directory not found: {root}")

    try:
        chroma_client.delete_collection(collection_name)
        log.debug("[%s] Dropped existing Chroma collection: %s", name, collection_name)
    except Exception:
        pass

    collection = chroma_client.get_or_create_collection(collection_name)
    vector_store = ChromaVectorStore(chroma_collection=collection)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    # Walk directory ourselves to properly exclude nested dirs
    # (SimpleDirectoryReader's exclude parameter doesn't work recursively)
    valid_files = []
    for f in root.rglob("*"):
        if not f.is_file():
            continue
        if f.suffix not in SUPPORTED_EXTENSIONS:
            continue
        if f.stat().st_size > MAX_FILE_BYTES:
            continue
        # Use same exclusion logic as structural map
        if any(ex in f.parts for ex in EXCLUDED_DIRS):
            continue
        valid_files.append(str(f))

    log.info("[%s] Found %d valid files after exclusions", name, len(valid_files))

    if not valid_files:
        log.warning("[%s] No files to index after applying filters", name)
        status = {
            "name": name,
            "path": str(root),
            "file_count": 0,
            "last_indexed": datetime.utcnow().isoformat() + "Z",
        }
        index_status[name] = status
        return status

    # Embed files one at a time for progress tracking
    total_files = len(valid_files)
    log.info("[%s] Embedding %d files...", name, total_files)

    for i, file_path in enumerate(valid_files):
        try:
            # Load and embed this file
            docs = SimpleDirectoryReader(
                input_files=[file_path],
                file_metadata=lambda fp: {"file_path": fp},
            ).load_data()

            if docs:
                VectorStoreIndex.from_documents(
                    docs,
                    storage_context=storage_context,
                    show_progress=False,
                )

            filename = Path(file_path).name
            index_progress[name] = {
                "current": i + 1,
                "total": total_files,
                "file": filename
            }
            if progress_callback:
                progress_callback(i + 1, total_files, filename)

        except Exception as e:
            log.warning("[%s] Failed to embed %s: %s", name, file_path, e)

    index_progress.pop(name, None)

    status = {
        "name": name,
        "path": str(root),
        "file_count": total_files,
        "last_indexed": datetime.utcnow().isoformat() + "Z",
    }
    index_status[name] = status
    log.info("[%s] Index complete — %d files indexed", name, total_files)
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
        collection_name = sanitize_collection_name(name)
        index = get_index(collection_name)
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

def read_file_from_scope(
    scope_name: str,
    relative_path: str,
    start_line: int | None = None,
    end_line: int | None = None
) -> str:
    """
    Read a file from a scope by its relative path and return its raw text.
    Used by the diff endpoint to supply the 'before' side of a diff view.
    Raises FileNotFoundError if the scope of file doesn't exist.

    Args:
        scope_name: Name of the scope
        relative_path: Path relative to scope root
        start_line: Optional starting line number (1-indexed, inclusive)
        end_line: Optional ending line number (1-indexed, inclusive)

    Returns:
        File content as string. If line range specified, returns only those lines
        with line numbers prepended (e.g., "42: code here")
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

    content = target.read_text(errors="ignore")

    # Return full file if no line range specified
    if start_line is None and end_line is None:
        log.info("[%s] read_file_from_scope: %s (full file)", scope_name, relative_path)
        return content

    # Parse line range
    lines = content.splitlines()
    total_lines = len(lines)

    # Convert to 0-indexed and validate
    start_idx = max(0, (start_line or 1) - 1)
    end_idx = min(total_lines, end_line or total_lines)

    if start_idx >= total_lines:
        raise ValueError(f"start_line {start_line} exceeds file length ({total_lines} lines)")

    # Extract requested lines with line numbers
    result_lines = []
    for i in range(start_idx, end_idx):
        line_num = i + 1
        result_lines.append(f"{line_num}: {lines[i]}")

    log.info(
        "[%s] read_file_from_scope: %s (lines %d-%d of %d)",
        scope_name, relative_path, start_idx + 1, end_idx, total_lines
    )
    return "\n".join(result_lines)

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
