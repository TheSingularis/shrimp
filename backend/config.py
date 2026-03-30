# Ollama configuration
OLLAMA_HOST = "http://127.0.0.1:11434"  # Default: managed locally with network access
OLLAMA_MODEL = "qwen2.5:14b"
EMBED_MODEL = "nomic-embed-text"
CHROMA_PATH = "./chroma_db"
NUM_CTX: int = 8192
CUSTOM_INSTRUCTIONS: str = ""
UI_THEME: str = "shrimp"  # "blue-purple" | "shrimp" | "refined-blue"
UI_LANGUAGE: str = "English"  # Language for LLM responses

# Tool calling configuration (Phase 0-1)
USE_TOOL_CALLING: bool = True  # Feature flag - ENABLED for testing
TOOL_CALLING_MAX_ITERATIONS: int = 10  # Prevent infinite loops
TOOL_CALLING_TIMEOUT_SECONDS: int = 120  # Max time for entire agentic loop

WATCHED_DIRS: list[dict] = [{'name': 'obsidian', 'path': '~/Documents/Personal/LLM Test', 'enabled': True, 'description': ''}, {'name': 'shrimp', 'path': '~/Documents/Code Projects/shrimp', 'enabled': True, 'description': ''}, {'name': 'Ash', 'path': '~/Documents/Code Projects/Sluiter-Lefter', 'enabled': True, 'description': ''}]
