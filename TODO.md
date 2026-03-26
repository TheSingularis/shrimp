# SHRIMP* — TODO

Reordered by impact and strategic value. Frontloaded with high-value features that enable future work or significantly improve UX.

---

## 🎯 Tier 1: High Impact, Medium Effort (RECOMMENDED NEXT)

- [ ] **Additional prompt instructions in settings** — Freetext field in settings that appends custom instructions to the system prompt. Huge flexibility gain for tuning SHRIMP's tone, focus, or domain knowledge per project without touching code. Persist to `config.py`.
  - **Why first:** Enables per-project customization immediately. Simple to implement, massive UX improvement.

- [ ] **Save conversations** — Persist chat history to JSON files on disk (one file per conversation). Auto-save after each exchange.
  - **Why second:** Foundation for all conversation management. Prevents losing work. Enables features below.

- [ ] **Retry prompt button** — Similar to ChatGPT/Claude, a button to regenerate the last assistant response. Common UX pattern users expect.
  - **Why third:** Easy win, improves iteration workflow significantly.

---

## 🏗️ Tier 2: Strategic Enablers (build on Tier 1)

- [ ] **Multiple conversation tabs** — Extend saved conversations to support multiple named tabs open simultaneously in the UI. Enables parallel work on different topics/files.
  - **Prerequisite:** Save conversations
  - **Value:** Natural extension once persistence exists

- [ ] **Tool calling refactor** — **BIG ONE.** Replace current prompt-chaining (intent detection, file selection, sentinel parsing) with Ollama's structured `tools` API.
  - Define tools: `read_file(scope, path)`, `edit_file(scope, path, content)`, `search_files(query)`, `list_scope(name)`
  - Model calls tools → Python executes → results fed back → model continues
  - **Benefits:**
    - Eliminates brittle prompt engineering and regex parsing
    - Natural multi-file/multi-step workflows
    - Easy to add new capabilities (web search, shell commands)
    - More reliable file edits (no more format compliance issues)
  - **PREREQUISITE:** Test `qwen2.5-coder:7b` tool calling reliability first
  - **Risk:** Medium-high. Tool calling quality varies by model.
  - **If it works:** Massive architecture simplification and capability unlock

---

## 🎨 Tier 3: Polish & Accessibility

- [ ] **Update Branding** — Update styling to use shrimp icons (`frontend/public/icons`) and cohesive color scheme. Maybe add theme options in settings.
  - **Why now:** Visual polish improves perceived quality. Quick win.

- [ ] **Mobile-responsive CSS** — Make layout work on small screens for phone/tablet access.
  - **Pairs with:** Ollama host settings (network access)

- [ ] **Ollama host settings** — Radio toggle between local (managed by SHRIMP) and external (user-supplied URL). Persist to `config.py`.
  - **Enables:** Network access from other devices
  - **Related:** Fix loopback binding (`0.0.0.0` instead of `127.0.0.1`)

---

## 🔮 Tier 4: Advanced Features (future)

- [ ] **Fork conversations** — Branch a conversation from any point in history into a new tab. Requires tree structure instead of flat array.
  - **Prerequisite:** Multiple conversation tabs

- [ ] **Electron app** — Package as desktop app with bundled Python backend and optional bundled Ollama.
  - **Why later:** Significant packaging effort. Current web app works well.

- [ ] **Tool calling phase 2** — Once tool calling refactor is stable, add:
  - Web search tool
  - Shell command execution tool
  - File system operations (create, delete, move)

---

## 💡 Nice to Have / Lower Priority

- [ ] **GPU utilization indicator** — Live GPU memory usage in header, polling `ollama ps`. Calculate predicted VRAM usage for context window.
- [ ] **Per-scope prompt context** — Optional description per scope injected into system prompt when active.
- [ ] **Index status indicator in header** — Small dot showing if active scopes are indexed.
- [ ] **File edit history** — Track all edits with timestamps for session review.
- [ ] **persist index dates between restarts** - When caching scope indexes, include the date so it properly populates when reloading the previous index from cache

---

## ✅ Completed (archive)

- [x] **Discard button** — Abandon pending file edit
- [x] **Stop / cancel button** — Abort streaming response
- [x] **Better streaming UI during file edits** — Stage indicators with spinner
- [x] **Context window slider in settings** — Expose `num_ctx` as user setting
- [x] **Multiple file edits** — Unified multi-file diff editor with quality control
