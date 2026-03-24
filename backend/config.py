OLLAMA_HOST = "http://127.0.0.1:11434"
OLLAMA_MODEL = "qwen2.5-coder:7b"
EMBED_MODEL = "nomic-embed-text"
CHROMA_PATH = "./chroma_db"
NUM_CTX: int = 8192

WATCHED_DIRS: list[dict] = [{'name': 'code', 'path': '~/Documents/Code Projects/test', 'enabled': False}, {'name': 'obsidian', 'path': '~/Documents/Personal/LLM Test', 'enabled': False}, {'name': 'shrimp', 'path': '~/Documents/Code Projects/shrimp', 'enabled': True}]
