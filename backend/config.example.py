OLLAMA_HOST = "http://localhost:11434"
OLLAMA_MODEL = "qwen2.5-coder:7b"
EMBED_MODEL = "nomic-embed-text"
CHROMA_PATH = "./chroma_db"
NUM_CTX: int = 8192
CUSTOM_INSTRUCTIONS: str = ""
UI_THEME: str = "shrimp"  # "blue-purple" | "shrimp" | "refined-blue"
UI_LANGUAGE: str = "English"

USE_TOOL_CALLING: bool = True
TOOL_CALLING_MAX_ITERATIONS: int = 10
TOOL_CALLING_TIMEOUT_SECONDS: int = 120

WEB_SEARCH_ENABLED: bool = False

SMTP_CONFIG: dict = {"enabled": False, "smtp_host": "", "smtp_port": 587, "smtp_ssl": False, "smtp_starttls": True, "username": "", "password": "", "from_name": "", "from_email": ""}
EMAIL_CONFIG: dict = {"enabled": False, "imap_host": "", "imap_port": 993, "imap_ssl": True, "username": "", "password": "", "mailbox": "Inbox", "fetch_max": 50, "poll_interval_minutes": 15, "index_in_rag": False}

WATCHED_DIRS: list[dict] = []
RSS_FEEDS: list[dict] = []
NEWS_INTERESTS: str = ""
AUTOMATION_CONFIG: dict = {"checklist_rollover": {"enabled": False}, "news_digest": {"enabled": False}, "daily_digest": {"enabled": False}, "email_triage": {"enabled": False}}
