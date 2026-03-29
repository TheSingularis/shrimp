# Changelog

All notable changes to SHRIMP* will be documented in this file.

---

## [Unreleased] — 2026-03-29

### Added

- **Project organization for conversations**: Group related conversations into projects with custom names, descriptions, and colors:
  - Create projects with modal UI featuring name, description, and 8 preset color options
  - Delete projects from the conversation sidebar
  - Move conversations between projects via drag-and-drop or right-click context menu
  - Collapsible project folders with conversation counts
  - Visual feedback during drag operations (highlighted drop zones)
  - Projects persist to `projects.json` file with automatic migration
  - Uncategorized section for conversations without a project
  - Theme-aware left accent border on project headers (uses primary theme color)
  - Small colored dot indicators show each project's custom color
  - Expanded state persists to localStorage

- **Shrimp branding with theme system**: Visual refresh with shrimp icon integration and 3 switchable color themes:
  - **Shrimp logo**: PNG icon displays in header, favicon, and welcome screen for empty conversations
  - **3 color themes**: Purple (violet-dominant, default), Shrimp (coral/pink/orange branding), and Blue (classic vibrant blue)
  - **Theme switcher**: Change themes in Settings drawer with instant visual updates
  - **Theme persistence**: Selected theme saves to backend config and loads on startup
  - All UI elements (buttons, borders, code blocks, etc.) adapt to theme colors using CSS variables
- **Expanded settings drawer**: Increased width from 360px to 480px (60% on tablets) with reorganized sections:
  - THEME section at the top for easy access
  - MODEL & CONTEXT grouped together
  - CUSTOM INSTRUCTIONS section
  - SCOPES with improved card-based layout
  - Better organization and spacing throughout
- **Consistent SVG icon system**: Replaced all emoji icons (⚙️, ✕, ✓, ✎) with Lucide React icons for:
  - Settings buttons, close buttons, checkmarks
  - Edit indicators, approve/reject actions
  - Tab controls, conversation management
  - Professional, scalable appearance across all screen sizes
- **Welcome screen**: Empty conversation state shows shrimp hero icon with welcoming message
- **Style guide documentation**: Comprehensive `docs/STYLE_GUIDE.md` documenting colors, typography, spacing, components, icons, animations, and responsive patterns
- **Language setting**: Configurable response language in Settings with 6 language options (English, Spanish, French, German, Chinese, Japanese):
  - Language preference persists to backend config
  - Prepends "Respond in {language} only" to every user message for reliable language control
  - Solves Qwen model multilingual issues where system prompts are ignored
  - Backend config: `UI_LANGUAGE` setting with GET/POST endpoints at `/settings/language`
- **Tool call artifact cleanup**: Removes raw tool call JSON, XML tags, and corrupted text from chat output:
  - Strips `<tool_call>...</tool_call>` XML tags
  - Removes standalone JSON like `{"name": "read_file", "arguments": {...}}`
  - Cleans corrupted text patterns (e.g., "iNdEx")
  - Applied to all content during streaming and final rendering
- **Theme-aware UI accents**: All accent colors now dynamically change with theme selection:
  - Loading spinner color matches theme primary
  - Message border accents (user/assistant) use theme primary
  - SHRIMP* asterisk in header uses theme primary
  - "You" label on user messages uses theme primary
  - Retry button hover state uses theme primary
  - Input focus ring and border use theme primary

- **Inline stage markers with real-time rendering**: Conversation history now shows greyed-out markers inline where actions occurred (e.g., "[Searched files: 'DND notes']", "[Read files: Session 21.md, combat-rules.md]"). Markers appear during streaming as tools complete, positioned naturally in the conversation flow. Include specific file paths, search queries, and scope names for full transparency. Parsed and styled in real-time - no raw tokens visible.
- **Tool calling architecture**: Replaced prompt-chaining with Ollama's native function calling API. The LLM can now directly call tools (`read_file`, `search_files`, `list_scope`, `propose_file_edit`) in an agentic loop, eliminating brittle regex parsing and multiple LLM roundtrips. Features:
  - Agentic workflow: model calls tools → backend executes → results fed back → model continues
  - Fallback parser for text-based tool calls (llama3.1:8b compatibility)
  - Feature flag for gradual rollout (`USE_TOOL_CALLING`, enabled by default)
  - 93.8% reliability achieved in testing
  - Streaming support maintained with tool execution markers
  - See `docs/tool-calling-architecture.md` for technical details
- **Security-focused file operations module** (`backend/file_ops.py`): All file writes now go through `write_accept()` with path validation, automatic backups, and escape prevention
- **Model recommendations documentation**: Comprehensive guide for selecting models based on VRAM (8GB, 16GB, 24GB+ tiers) with specific recommendations for tool calling support
- **Comprehensive architecture documentation** (`docs/tool-calling-architecture.md`): Step-by-step walkthrough of tool calling flow with function call traces
- **Network access from mobile/tablet devices**: SHRIMP can now be accessed from any device on your local network. The frontend, backend, and Ollama now bind to `0.0.0.0` instead of `127.0.0.1`, and the frontend dynamically uses `window.location.hostname` to connect to the backend. Access the UI from your phone or tablet by visiting `http://<YOUR_IP>:5173`.
- **Mobile-responsive UI**: The interface is now optimized for touch devices and small screens:
  - Diff viewers appear full-screen on mobile devices for better usability
  - Header, tabs, scope pills, and settings drawer scale appropriately for small screens
  - All interactive elements meet the 44px minimum touch target size
  - Supports both portrait and landscape orientations
  - Responsive breakpoints at 768px (tablets) and 480px (phones)
- **Multiple conversation tabs**: Work with multiple conversations simultaneously using browser-style tabs. Features:
  - Tab bar above the chat panel with active tab highlighting
  - Create new tabs with the + button
  - Close tabs with × button (automatically creates a new tab if closing the last one)
  - Each tab maintains separate conversation state, messages, and scope selection
  - Smart tab switching: loading an already-open conversation switches to its existing tab
  - Auto-save on tab switch to prevent data loss
  - Tab titles auto-update based on first user message
  - Seamless integration with conversation sidebar (loads into new tabs or switches to existing)
- **Multi-file editing**: Request changes across multiple files in one conversation (e.g., "update README and CHANGELOG to document feature X"). Features:
  - 4-way intent detection: questions, single-file edits, multi-file edits, unclear requests
  - Unified diff viewer for all edits (single or multiple files)
  - Per-file approve/reject controls
  - Batch apply with progress tracking
  - Supports up to 5 files per request
  - Quality control loop with automatic refinement when issues detected
- Dev testing: switched development/test workflow to use `distrobox` for faster iterative testing on non-NixOS distributions. See `README.md` for basic usage notes.
- Chat UI: real-time stage indicators during LLM operations show progress (e.g., "Finding file…", "Reading file…", "Thinking…", "Searching…", "Editing 2/3…") with animated spinner.
- **Retry button**: Regenerate the last assistant response with a single click. Button appears in the message header of the last assistant message when not streaming.
- **Create new files**: Model can now create new files in addition to editing existing ones. Simply request "create a file for X" and the model will propose the new file content for review in the diff viewer. Parent directories are created automatically if needed.

### Changed

- **Purple theme enhancement**: Blue/Purple theme shifted to be more purple-dominant (Tailwind violet-500/600) for clear distinction from Refined Blue theme
- **Theme selector order**: Reordered to Shrimp, Purple, Blue (left to right) and simplified labels
- **Theme-aware UI colors**: All hardcoded color references now use theme CSS variables for dynamic theming
- **Settings drawer width**: Expanded from 360px to 480px on desktop for better content organization
- **Responsive drawer sizing**: Tablets now use 60% width (was 90%) for better proportions
- **Stage marker artifact cleanup**: Improved parsing to prevent stray JSON fragments from appearing in chat output
- **Settings button styling**: Increased size and weight of settings gear icon for better visibility
- **System prompts**: Added "Respond in English only" directive to all system prompts (main chat, intent detection, general knowledge, file editing, code review) as fallback language control
- **Default model**: Switched from `qwen2.5-coder:7b` to `llama3.1:8b` for superior tool calling support (100% success rate in testing, fast 4-5s responses)
- **Settings panel error display**: Error messages now appear as inline red text instead of intrusive alert popups. Input field clears automatically on error for better UX
- **Model deletion behavior**: Deleting the currently active model now auto-selects a fallback model from available options instead of leaving no model selected
- **Model list filtering**: Embedding models (e.g., nomic-embed-text) are now hidden from the chat model selection list to prevent confusion
- **UI redesign with blue/purple theme**: Complete visual refresh of the chat interface with a modern cool-toned color scheme inspired by Discord, VS Code, and Linear. Changes include:
  - New color palette: soft periwinkle blue (#5B7FFF) as primary accent replacing green (#4ade80)
  - Deep blue-tinted backgrounds (#0D0F17, #161925) replacing neutral grays
  - Redesigned message layout: user messages in compact bubbles (65% max-width), assistant messages full-width with left border accent
  - Increased spacing throughout (3rem between message groups vs 1.5rem)
  - Larger, more prominent input field with rounded corners and blue glow on focus
  - Gradient send button (blue to purple) with hover scale animation
  - Sans-serif system font stack for UI elements (monospace only for code)
  - Improved typography: 17px base font size, 1.6 line height
  - Updated code blocks, links, and markdown styling to match new theme
- **Diff editor**: Consolidated to unified multi-file diff viewer for all edits (1-N files). Single-file edits now use the same tabbed interface as multi-file edits for consistency.
- Backend: updated file-reading logic used by the assistant — see `backend/file_ops.py` and `backend/rag.py` for implementation details and new behaviours around path expansion and ignored directories.
- **Streaming markdown rendering**: Assistant responses now render markdown formatting in real-time during streaming, allowing you to watch code blocks, headers, and other formatting appear as tokens arrive (previously showed raw text until completion). Incomplete markdown elements (unclosed code fences, bold, italic, etc.) are temporarily completed during streaming to prevent visual snaps when the final closing tag arrives.

### Fixed

- **Pull model error handling**: Pulling non-existent or invalid models now properly displays error messages from Ollama instead of silently failing
- **Model selection validation**: Selecting a model now validates that it exists in Ollama before applying the change, preventing "model not found" errors during chat
- Stage indicators now properly transition in question mode (no longer stuck on "Processing…")
- Added size check to quality control loop that flags edits removing >40% of content
- Excessive content removal now automatically triggers refinement with preservation guidance
- Conversation `created_at` timestamp now properly preserved when updating existing conversations (was incorrectly resetting to current time)
- **iOS Safari keyboard handling**: Fixed viewport issues on iPad/iPhone where keyboard would push content off-screen. The app now properly shrinks to accommodate the keyboard using the visualViewport API, keeping all UI elements visible when typing. Implementation includes:
  - Custom `useVisualViewport` React hook that dynamically adjusts container height
  - Position-fixed app container that tracks visual viewport changes
  - Proper flex layout with `min-h-0` on message list for correct scrolling behavior
  - Global CSS rules to prevent page scrolling and rubber-banding on iOS
- **UI alignment fixes**: Settings button now properly hugs the right edge of the header, and send/stop buttons are perfectly centered with consistent padding
- **File creation flow**: Fixed bug where LLM would claim to create files without showing diff editor:
  - Backend now emits correct sentinel format with `type` field and `original` instead of `old`
  - Updated system prompt to explicitly forbid claiming file creation without calling the tool
  - Added stronger instructions that files are ONLY created when `propose_file_edit` tool is called
  - New files (where original content is empty) now properly trigger diff editor for user approval


## [v0.1.0] — 2025-07-15

### Added

- Local-first AI chat assistant powered by Ollama — all inference stays on your machine
- RAG (Retrieval-Augmented Generation) over local files using LlamaIndex and ChromaDB
- Support for multiple scopes: index separate directories (e.g. code, notes) and toggle which ones are active per conversation
- Scope selector pill-buttons in the header to control which directories are searched for each message
- Settings drawer with model switcher (change the active Ollama model instantly) and full scope management (add, remove, enable/disable, re-index)
- Per-scope and bulk re-index triggers from the settings drawer, with live spinner feedback while indexing runs
- Streaming chat responses — tokens appear in real time as the model generates them
- Index status display showing file count and last-indexed timestamp per scope
- Structured backend logging to `.ollama/backend.log` covering index progress, chat requests, config changes, and errors
- Automatic port clearing on shell start — stale processes on ports 8000 and 5173 are killed before services start
- Full dev environment managed by a single `nix-shell` command — starts Ollama, the backend, and the frontend automatically
- Indexed file types: `.md`, `.py`, `.ts`, `.tsx`, `.js`, `.jsx`, `.json`, `.yaml`, `.yml`, `.toml`, `.txt`, `.env.example`

- **New:** Indexing now automatically skips common dependency and junk folders (`node_modules`, `.git`, `.venv`, `dist`, `build`, `out`, `chroma_db`, etc.) for much faster indexing of large projects.

---

## [v0.2.0] — 2026-03-20

### Added

- Enhanced markdown rendering in the chat panel, including support for `markdown` code fences that render inner content as markdown.
- Introduced `unwrapOuterMarkdownFence` function to handle unwrapping of markdown fences for cleaner rendering.
- Added custom `code` and `pre` handlers for improved syntax highlighting and fallback rendering.
- Updated the `ChatPanel` component to use a shared `makeComponents` function for consistent markdown rendering.

### Fixed

- Resolved spinner animation issues to ensure smooth transitions during streaming.
- Addressed type errors in the `code` and `pre` handlers by using `React.DetailedHTMLProps` for proper compatibility.
- Fixed cascading renders caused by synchronous state updates in the spinner logic.

---

[v0.1.0]: https://github.com/TheSingularis/shrimp/releases/tag/v0.1.0
[v0.2.0]: https://github.com/TheSingularis/shrimp/releases/tag/v0.2.0
