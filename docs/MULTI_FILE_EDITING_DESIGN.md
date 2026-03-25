# Multi-File Editing Architecture Design

**Status**: Design Phase
**Date**: 2026-03-24
**Author**: Claude Sonnet 4.5

---

## Overview

This document outlines the architecture for adding multi-file editing support to SHRIMP. Currently, SHRIMP can only propose edits to a single file at a time. This feature will enable batch file editing workflows like:

- "Refactor the authentication logic across main.py, auth.py, and config.py"
- "Update README.md and CHANGELOG.md to document the new feature"
- "Fix the bug in the request handler and add tests"

---

## Goals

1. **User Experience**: Let users request changes to multiple files in one conversation turn
2. **Transparency**: Show all proposed changes with individual diffs before applying
3. **Control**: Allow partial approval (accept some files, reject others)
4. **Safety**: Maintain the review-before-apply workflow SHRIMP already has
5. **Backwards Compatibility**: Keep single-file editing working as-is

---

## Architecture Components

### 1. Intent Detection (3-Way Classification)

**Current State**: Binary classification
```python
is_file_edit: bool  # true = edit mode, false = question mode
```

**New State**: 3-way classification
```python
intent: "question" | "single_file_edit" | "multi_file_edit"
```

**Classification Rules**:
- `"question"`: User asks "how would I...", "what's the best way...", "explain..."
- `"single_file_edit"`: User requests edit to ONE specific file
  - "update README to add X"
  - "fix the bug in main.py"
- `"multi_file_edit"`: User requests changes across multiple files
  - "refactor auth across main.py and auth.py"
  - "update README and CHANGELOG"
  - "add feature X" (if implementation clearly needs multiple files)

**Implementation**: Update `intent_prompt` in `main.py` lines 196-209

---

### 2. Backend: Multi-File Diff Generation

#### 2.1 New Route Path

```python
# Existing paths:
# - is_file_edit=false → normal chat (question answering)
# - is_file_edit=true + single file → single file edit

# New path:
# - intent="multi_file_edit" → multi-file edit orchestration
```

#### 2.2 Multi-File Edit Flow

```
1. File Selection (already exists, but select MULTIPLE files)
   ↓
2. LLM Planning Phase
   - Prompt: "You need to modify these N files to implement X"
   - Output: JSON structure with changes per file
   ↓
3. Diff Generation
   - For each file:
     * Read current content
     * Generate new content (LLM call or structured edit)
     * Create diff
   ↓
4. Stream Response
   - Yield stage tokens (__STAGE__planning, __STAGE__editing_file_1, etc.)
   - Yield multi-file sentinel with all diffs
```

#### 2.3 Structured Output Format

**Option A: Single LLM call with structured JSON**
```python
{
  "type": "multi_file_edit",
  "description": "Refactor authentication to use new auth module",
  "files": [
    {
      "scope": "shrimp",
      "path": "backend/main.py",
      "original": "...",  # full file content
      "new": "...",       # full new content
      "reason": "Move auth logic to separate module"
    },
    {
      "scope": "shrimp",
      "path": "backend/auth.py",
      "original": "",     # empty if new file
      "new": "...",
      "reason": "New auth module with login/logout functions"
    }
  ]
}
```

**Option B: Multiple LLM calls (one per file)**
- Pro: Easier to implement, reuses existing single-file logic
- Con: Slower, more LLM calls

**Recommendation**: Start with Option B, migrate to Option A if tool calling becomes available

#### 2.4 New Generator Function

```python
async def stream_multi_file_edit():
    """Generate diffs for multiple files"""
    yield "__STAGE__planning"

    # Select files (reuse existing file selection logic)
    selected_files = {...}  # {scope: [paths]}

    file_diffs = []
    for scope_name, paths in selected_files.items():
        for path in paths:
            yield f"__STAGE__editing_{path}"

            # Read current content
            original = rag.read_file_from_scope(scope_name, path)

            # Generate new content (LLM call)
            new_content = await generate_file_edit(
                path, original, req.message, context
            )

            file_diffs.append({
                "scope": scope_name,
                "path": path,
                "original": original,
                "new": new_content,
            })

    yield "__STAGE__done"

    # Emit multi-file sentinel
    sentinel = json.dumps({
        "type": "multi_file_edit",
        "files": file_diffs
    })
    yield f"\n\n__SHRIMP_MULTI_EDIT__{sentinel}"
```

---

### 3. Frontend: Multi-File Diff Viewer

#### 3.1 New Component: `MultiFileDiffPanel.tsx`

**Layout Options**:

**Option A: Tabbed Interface** (Recommended)
```
┌─────────────────────────────────────────────────┐
│ ✎ Multi-File Edit Proposal                     │
├─────────────────────────────────────────────────┤
│ [main.py]  [auth.py]  [config.py]              │  ← Tabs
├─────────────────────────────────────────────────┤
│                                                 │
│  Monaco Diff Editor                             │
│  (showing currently selected tab)               │
│                                                 │
│                                                 │
├─────────────────────────────────────────────────┤
│ [✓ Approve] [✕ Reject] │ [Apply All Approved]  │
└─────────────────────────────────────────────────┘
```

**Option B: Accordion/Expandable** (More compact)
```
┌─────────────────────────────────────────────────┐
│ ✎ Multi-File Edit Proposal (3 files)           │
├─────────────────────────────────────────────────┤
│ ▼ main.py                      [✓] [✕]         │
│   ┌─────────────────────────────────────┐      │
│   │ Monaco Diff (collapsed by default)  │      │
│   └─────────────────────────────────────┘      │
│                                                 │
│ ▶ auth.py (new file)            [✓] [✕]        │
│                                                 │
│ ▶ config.py                     [✓] [✕]        │
├─────────────────────────────────────────────────┤
│              [Apply All Approved (2/3)]         │
└─────────────────────────────────────────────────┘
```

**Recommendation**: Start with **Option A (Tabs)** for familiarity, add Option B later for power users

#### 3.2 State Management

```typescript
interface MultiFileDiff {
  scope: string;
  path: string;
  original: string;
  new: string;
}

interface MultiFileEditState {
  files: MultiFileDiff[];
  activeTabIndex: number;
  fileStates: Record<string, {
    approved: boolean;
    rejected: boolean;
    applied: boolean;
  }>;
}
```

#### 3.3 User Interactions

1. **Tab Click**: Switch between files
2. **Approve Button**: Mark file as approved (checkbox/pill turns green)
3. **Reject Button**: Mark file as rejected (checkbox/pill turns red/gray)
4. **Apply All Approved**:
   - Batch apply all approved files
   - Show progress indicator (1/3, 2/3, 3/3)
   - Handle partial failures gracefully
5. **Close**: Dismiss the panel (only if no files are pending)

#### 3.4 Integration with ChatPanel

```typescript
// In ChatPanel.tsx
const [multiFilePendingEdit, setMultiFilePendingEdit] =
  useState<MultiFileEditState | null>(null);

// In parseSentinel()
if (sentinel?.type === "multi_file_edit") {
  setMultiFilePendingEdit({
    files: sentinel.files,
    activeTabIndex: 0,
    fileStates: Object.fromEntries(
      sentinel.files.map(f => [f.path, {
        approved: false,
        rejected: false,
        applied: false
      }])
    )
  });
}
```

---

### 4. API Changes

#### 4.1 New Endpoint: Batch Apply

**Option A: Single endpoint for batch**
```python
@app.post("/file/apply-batch")
async def apply_batch_edit(req: BatchApplyEditRequest):
    """Apply multiple file edits atomically"""
    results = []
    for file_edit in req.files:
        try:
            # Apply edit (same as single-file)
            apply_single_edit(file_edit)
            results.append({"path": file_edit.path, "status": "success"})
        except Exception as e:
            results.append({"path": file_edit.path, "status": "error", "error": str(e)})
    return {"results": results}
```

**Option B: Reuse existing `/file/apply` endpoint**
- Call it N times from frontend
- Simpler backend, more network calls
- Easier to implement incremental progress

**Recommendation**: Start with **Option B**, add Option A if performance becomes an issue

#### 4.2 New Pydantic Models

```python
class BatchApplyEditRequest(BaseModel):
    files: list[ApplyEditRequest]

class BatchApplyEditResponse(BaseModel):
    results: list[dict]  # [{path: str, status: "success"|"error", error?: str}]
```

---

### 5. Stage Indicators

**New stages for multi-file editing**:
```python
STAGE_LABELS = {
    # Existing
    "finding": "Finding files…",
    "reading": "Reading files…",
    "thinking": "Thinking…",
    "searching": "Searching…",
    "done": "Done",

    # New for multi-file
    "planning": "Planning changes…",
    "editing_file_1": "Editing file 1/N…",
    "editing_file_2": "Editing file 2/N…",
    # ... dynamic based on file count
}
```

**Alternative**: Generic stage like `"editing": "Editing files (2/5)…"`

---

## Implementation Phases

### Phase 1: Backend Foundation (Task #4-5)
- [ ] Update intent detection to 3-way classification
- [ ] Add multi-file selection logic (select N files instead of 1)
- [ ] Implement `stream_multi_file_edit()` generator
- [ ] Test with 2-3 file edits manually via curl

### Phase 2: Frontend UI (Task #6)
- [ ] Create `MultiFileDiffPanel.tsx` component
- [ ] Implement tabbed interface with Monaco diffs
- [ ] Add approve/reject per-file controls
- [ ] Integrate with ChatPanel sentinel parsing

### Phase 3: Batch Application (Task #7)
- [ ] Implement batch apply logic (reuse existing endpoint)
- [ ] Add progress indicators
- [ ] Handle partial failures (some succeed, some fail)
- [ ] Update UI state per file as applied

### Phase 4: Polish & Documentation (Task #8-9)
- [ ] Update README with multi-file examples
- [ ] Add to CHANGELOG under Unreleased
- [ ] Update CLAUDE.md architecture section
- [ ] End-to-end testing with real workflows

---

## Open Questions & Decisions

### Q1: How many files should we support?
- **Proposal**: Limit to 5 files per request initially
- **Reason**: UI complexity, LLM context limits, performance
- **Future**: Increase if needed based on usage

### Q2: Should we support creating new files?
- **Current**: Single-file edit only edits existing files
- **Proposal**: Yes, support creating new files (empty `original`)
- **Implementation**: Check if file exists, handle gracefully

### Q3: What if files conflict (e.g., pending single-file edit)?
- **Proposal**: Clear pending single-file edits when multi-file edit arrives
- **Alternative**: Show warning, let user decide

### Q4: Should we use LLM tool calling or structured JSON?
- **Current**: Ollama may not support tool calling well
- **Proposal**: Start with structured JSON output (format: "json")
- **Future**: Migrate to tool calling when stable

### Q5: How to handle file selection with multiple files?
- **Current**: File selection LLM returns `{"files": {"scope": ["path1", "path2"]}}`
- **Proposal**: Reuse existing logic, just select multiple files
- **Note**: Already supports multiple files in response format

---

## Success Metrics

1. **Accuracy**: Intent detection correctly routes 90%+ of requests
2. **Usability**: Users can approve/reject individual files easily
3. **Safety**: No unintended file writes (all go through diff review)
4. **Performance**: Multi-file edits complete in <30s for 5 files
5. **Adoption**: 30%+ of edit requests are multi-file (shows feature value)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM generates invalid edits | High | Show diffs, let user review before apply |
| Context window overflow | Medium | Limit to 5 files, use section extraction |
| UI complexity overwhelms users | Medium | Start with tabs (familiar), add accordion later |
| Partial apply failures confuse state | High | Clear error messages, track per-file state |
| Intent detection misclassifies | High | Improve prompt with more examples, add clarification flow |

---

## Alternatives Considered

### Alt 1: Keep Single-File Only
- **Pro**: Simpler, already works
- **Con**: Users have to make multiple requests for related changes

### Alt 2: Use External Tools (e.g., aider, cursor)
- **Pro**: Offload complexity
- **Con**: Not local-first, breaks SHRIMP's privacy model

### Alt 3: Sequential Single-File Edits
- **Pro**: Reuses existing code
- **Con**: No batch review, no atomic apply, poor UX

**Decision**: Implement multi-file editing natively (this design)

---

## Next Steps

1. **Review this design** with project stakeholders
2. **Implement Phase 1** (backend foundation)
3. **Prototype UI** in Phase 2 (tabs + Monaco)
4. **Iterate** based on testing and feedback

---

## Appendix: Example Workflows

### Workflow 1: Update Documentation
**User**: "Update README and CHANGELOG to document the new streaming feature"

1. Intent detection → `multi_file_edit`
2. File selection → `{shrimp: ["README.md", "CHANGELOG.md"]}`
3. LLM generates new content for each file
4. Frontend shows tabbed diff viewer with 2 tabs
5. User approves both → Apply All Approved
6. Both files written to disk

### Workflow 2: Refactor Code
**User**: "Move the auth logic from main.py into a new auth.py module"

1. Intent detection → `multi_file_edit`
2. File selection → `{shrimp: ["backend/main.py"]}`
3. LLM realizes it needs to create `auth.py` too
4. Generates:
   - `main.py`: Remove auth code, import from auth
   - `auth.py`: New file with auth functions
5. Frontend shows 2 files (one existing, one new)
6. User approves both → Apply All Approved

### Workflow 3: Partial Rejection
**User**: "Fix the login bug in auth.py and update tests in test_auth.py"

1. Intent detection → `multi_file_edit`
2. File selection → `{shrimp: ["backend/auth.py", "tests/test_auth.py"]}`
3. LLM generates diffs for both
4. Frontend shows tabbed diff viewer
5. User reviews:
   - auth.py: ✓ Approve (fix looks good)
   - test_auth.py: ✕ Reject (wrong test approach)
6. User clicks "Apply All Approved" → only auth.py is written
7. User can follow up with "update the test to use mocks instead"

---

**End of Design Document**
