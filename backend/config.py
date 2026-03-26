OLLAMA_HOST = "http://127.0.0.1:11434"
OLLAMA_MODEL = "qwen2.5-coder:14b"
EMBED_MODEL = "nomic-embed-text"
CHROMA_PATH = "./chroma_db"
NUM_CTX: int = 16384
CUSTOM_INSTRUCTIONS: str = ""

WATCHED_DIRS: list[dict] = [{'name': 'obsidian', 'path': '~/Documents/Personal/LLM Test', 'enabled': True}, {'name': 'shrimp', 'path': '~/Documents/Code Projects/shrimp', 'enabled': True}]
