# Ollama configuration
OLLAMA_HOST = "http://0.0.0.0:11434"  # Default: managed locally with network access
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

# Web tools (Phase 2) — disabled by default; enable in Settings
WEB_SEARCH_ENABLED: bool = True  # Allow LLM to search the web and fetch URLs

SMTP_CONFIG: dict = {'enabled': True, 'smtp_host': 'smtp.mail.me.com', 'smtp_port': 587, 'smtp_ssl': False, 'smtp_starttls': True, 'username': 'jordan.sluiter@icloud.com', 'password': 'tsce-trpp-sloa-xsjv', 'from_name': 'Jordan Sluiter', 'from_email': ''}

EMAIL_CONFIG: dict ={'enabled': True, 'imap_host': 'imap.mail.me.com', 'imap_port': 993, 'imap_ssl': True, 'username': 'jordan.sluiter@icloud.com', 'password': 'tsce-trpp-sloa-xsjv', 'mailbox': 'Inbox', 'fetch_max': 50, 'poll_interval_minutes': 15, 'index_in_rag': False}

WATCHED_DIRS: list[dict] =[{'name': 'obsidian', 'path': '~/Documents/Personal', 'enabled': True, 'description': ''}, {'name': 'shrimp', 'path': '~/Documents/Code Projects/shrimp', 'enabled': True, 'description': 'This codebase contains a Python backend with RESTful APIs and a React/TypeScript frontend for conversational interfaces and multi-file editing functionalities, along with extensive documentation and settings configurations.'}, {'name': 'Ash', 'path': '~/Documents/Code Projects/Sluiter-Lefter', 'enabled': True, 'description': ''}]
RSS_FEEDS: list[dict] = [{"url": "https://feedx.net/rss/ap.xml", "name": "Associated Press", "enabled": True}, {"url": "http://feeds.bbci.co.uk/news/rss.xml", "name": "BBC Top Stories", "enabled": True}]
