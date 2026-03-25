# Stage Token & Sentinel Fix Verification

## What Was Fixed
1. ✅ Stage tokens now properly formatted as `__STAGE__editing_1_of_2` (was: `1of2`)
2. ✅ Sentinels properly formatted as `__SHRIMP_EDIT__` and `__SHRIMP_MULTI_EDIT__` (was missing `__` prefix)
3. ✅ Frontend correctly parses and displays stage indicators

## Test Cases

### Test 1: Single-File Edit - Stage Indicators
**Action**: In the SHRIMP UI, send this message:
```
update README.md to add a new section about testing
```

**Expected Behavior**:
- Stage indicator should show: "Finding file…" → "Reading file…" → "Thinking…" → "Done"
- NO "Processing…" should appear stuck
- A diff editor should open showing the proposed changes to README.md
- The diff editor should display properly (not show raw `SHRIMP_EDIT` text)

**Pass Criteria**: ✅ All stage transitions visible, diff editor opens cleanly

---

### Test 2: Multi-File Edit - Progressive Stage Indicators
**Action**: Send this message:
```
update README.md and CHANGELOG.md to document the stage indicator fix
```

**Expected Behavior**:
- Stage indicator should show:
  - "Planning changes…"
  - "Editing file 1/2…"
  - "Reviewing file 1/2…"
  - "Refining file 1/2…" (if critique finds issues)
  - "Editing file 2/2…"
  - "Reviewing file 2/2…"
  - "Refining file 2/2…" (if critique finds issues)
  - "Done"
- Multi-file diff panel should open with tabs for both files
- NO raw `__SHRIMP_MULTI_EDIT__` text should appear in the chat
- NO "Processing…" should get stuck

**Pass Criteria**: ✅ All numbered stage transitions visible, multi-file diff panel opens with 2 tabs

---

### Test 3: Question Mode - Basic Stages
**Action**: Send this message:
```
how does the RAG system work in this codebase?
```

**Expected Behavior**:
- Stage indicator should show: "Searching…" → "Thinking…"
- Response should be markdown text (no diff editor)
- Stage should clear when response completes

**Pass Criteria**: ✅ Stages transition properly, no stuck "Processing…"

---

## Verification Steps

After each test:
1. ✅ Check that stage indicator updates (not stuck on "Processing…")
2. ✅ Check that no raw sentinel text appears (no `SHRIMP_EDIT` or `__SHRIMP_EDIT__` visible)
3. ✅ Check that diff editors open cleanly
4. ✅ Check browser console for any JavaScript errors (F12)

## Report Results
After running all 3 tests, report:
- Which tests passed ✅
- Which tests failed ❌
- Any unexpected behavior
- Screenshot if any visual issues
