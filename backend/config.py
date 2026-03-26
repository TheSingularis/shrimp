OLLAMA_HOST = "http://127.0.0.1:11434"
OLLAMA_MODEL = "qwen2.5-coder:14b"
EMBED_MODEL = "nomic-embed-text"
CHROMA_PATH = "./chroma_db"
NUM_CTX: int = 16384
CUSTOM_INSTRUCTIONS: str = ""

WATCHED_DIRS: list[dict] = [
    {'name': 'obsidian', 'path': '~/Documents/Personal/LLM Test', 'enabled': True, 'description': 'This directory contains personal notes and documentation primarily focused on a Dungeons & Dragons campaign titled "Storm Kings Thunder," including character sheets, NPC details, location descriptions, key items, session logs, and other related content. Additionally, there are files from a book club discussing Blake Crouch\'s novel "Recursion."'},
    {'name': 'shrimp', 'path': '~/Documents/Code Projects/shrimp', 'enabled': True, 'description': 'This directory contains a React/TypeScript frontend with Vite build configuration and ESLint setup, alongside a Python backend including configuration and main scripts. It also includes comprehensive documentation, changelog, and instructions for contributions.'}
]
