"""
Stub out heavy/config dependencies before any backend module is imported.
This lets us test pure functions without needing Ollama, ChromaDB, or config.py.
"""
import sys
import types
from pathlib import Path
from unittest.mock import MagicMock

BACKEND_DIR = Path(__file__).parent.parent
EMAIL_BACKEND_DIR = BACKEND_DIR.parent / "plugins" / "email" / "backend"
sys.path.insert(0, str(BACKEND_DIR))
sys.path.insert(0, str(EMAIL_BACKEND_DIR))

# Minimal config stub — real config.py requires local secrets
config_stub = types.ModuleType("config")
config_stub.OLLAMA_HOST = "http://localhost:11434"
config_stub.OLLAMA_MODEL = "test-model"
config_stub.EMBED_MODEL = "nomic-embed-text"
config_stub.WATCHED_DIRS = []
config_stub.NUM_CTX = 4096
config_stub.USE_TOOL_CALLING = False
config_stub.SHRIMP_CONFIG_DIR = Path("/tmp/shrimp-test")
sys.modules["config"] = config_stub

# Stub modules with heavy deps or I/O that pure functions don't need
for _mod in ("rag", "file_ops", "obsidian_ops", "notifications",
             "email_sync", "scheduler", "email_idle", "checklist",
             "conversations", "projects"):
    sys.modules[_mod] = MagicMock()
