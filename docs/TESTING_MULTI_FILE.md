# Multi-File Editing Testing Checklist

This document provides a comprehensive testing checklist for the multi-file editing feature.

---

## Prerequisites

1. Start SHRIMP:
   ```sh
   npm run web
   ```

2. Ensure you have a scope with multiple editable files (e.g., shrimp itself)

3. Open browser to http://localhost:5173

---

## Test Cases

### 1. Intent Detection

**Test 1.1: Question Mode**
- [ ] Ask: "how would I add multi-file editing support?"
- [ ] Expected: Explanation, no file edits proposed
- [ ] Backend log should show: `intent=question`

**Test 1.2: Single-File Edit**
- [ ] Say: "update README.md to add a new feature section"
- [ ] Expected: Single diff panel opens (existing behavior)
- [ ] Backend log should show: `intent=single_file_edit`

**Test 1.3: Multi-File Edit**
- [ ] Say: "update README.md and CHANGELOG.md to document feature X"
- [ ] Expected: Multi-file diff panel opens with 2 tabs
- [ ] Backend log should show: `intent=multi_file_edit`

---

### 2. Multi-File Diff Viewer

**Test 2.1: Basic UI**
- [ ] Request multi-file edit (e.g., "update README and CHANGELOG")
- [ ] Verify multi-diff panel appears on right side
- [ ] Check header shows "Multi-File Edit Proposal (N files)"
- [ ] Verify all tabs are visible
- [ ] Click each tab, verify Monaco diff editor switches

**Test 2.2: Stage Indicators**
- [ ] Watch for stage tokens during streaming:
  - [ ] `__STAGE__planning` → "Planning changes…"
  - [ ] `__STAGE__editing_1_of_N` → "Editing file 1/N…"
  - [ ] `__STAGE__editing_2_of_N` → "Editing file 2/N…"
  - [ ] `__STAGE__done` → "Done"
- [ ] Verify spinner animates during stages

**Test 2.3: File Status**
- [ ] Click "Approve" on first file → tab shows ✓ and turns green
- [ ] Click "Reject" on second file → tab shows ✕ and grays out
- [ ] Leave third file neutral → no icon
- [ ] Verify apply button updates count: "Apply All Approved (1/3)"

---

### 3. Batch Application

**Test 3.1: Partial Apply**
- [ ] Approve 2 files, reject 1 file
- [ ] Click "Apply All Approved"
- [ ] Verify progress: button shows "Applying..."
- [ ] Wait for completion
- [ ] Verify applied files show ✓ Applied
- [ ] Verify rejected file unchanged
- [ ] Check disk: approved files should be written

**Test 3.2: Full Apply**
- [ ] Approve all files
- [ ] Click "Apply All Approved"
- [ ] Verify all files show ✓ Applied
- [ ] Verify panel auto-closes after ~1 second
- [ ] Check disk: all files should be written

**Test 3.3: Reject All**
- [ ] Reject all files
- [ ] Verify apply button is disabled
- [ ] Close panel manually
- [ ] Verify no files were written to disk

---

### 4. Error Handling

**Test 4.1: File Read Error**
- [ ] Request edit to a file that doesn't exist
- [ ] Expected: Backend logs warning, continues with other files
- [ ] UI should show error state or skip the file

**Test 4.2: File Write Error**
- [ ] Make a file read-only: `chmod 444 test.md`
- [ ] Request multi-file edit including that file
- [ ] Approve all and apply
- [ ] Expected: Error logged, other files still apply
- [ ] UI should show which files failed

**Test 4.3: Network Disconnect**
- [ ] Start multi-file edit
- [ ] Stop backend mid-stream: `Ctrl+C`
- [ ] Expected: Frontend shows partial response or error
- [ ] Restart, verify state didn't corrupt

---

### 5. Edge Cases

**Test 5.1: Single File as Multi-File**
- [ ] Say: "update README.md" (single file, but intent unclear)
- [ ] Check backend log for intent detection
- [ ] Verify correct path (should be single_file_edit)

**Test 5.2: More Than 5 Files**
- [ ] Request: "update README, CHANGELOG, CLAUDE.md, package.json, main.py, and config.py"
- [ ] Expected: Backend limits to 5 files
- [ ] Backend log should show: "limiting to 5"
- [ ] UI shows only 5 tabs

**Test 5.3: Duplicate Files**
- [ ] Request: "update README and README to add feature"
- [ ] Expected: Only one README in the file list
- [ ] No duplicate tabs

**Test 5.4: Mixed Scopes**
- [ ] Enable multiple scopes (e.g., "shrimp" and "notes")
- [ ] Request edit across both scopes
- [ ] Expected: Files from both scopes appear
- [ ] Each file has correct scope label

---

### 6. Integration with Single-File Editing

**Test 6.1: Switching Modes**
- [ ] Open multi-file diff panel
- [ ] Don't apply yet
- [ ] Request single-file edit: "fix typo in main.py"
- [ ] Expected: Single-file diff replaces multi-file panel

**Test 6.2: Pending Edits**
- [ ] Open multi-file diff, approve some files
- [ ] Open another multi-file edit request
- [ ] Expected: Previous panel closes, new one opens
- [ ] No stale state

**Test 6.3: Close and Reopen**
- [ ] Open multi-file diff panel
- [ ] Close it (X button)
- [ ] Request same edit again
- [ ] Expected: Panel reopens fresh, no leftover state

---

### 7. Performance

**Test 7.1: 5 Large Files**
- [ ] Request edit to 5 files (each ~500 lines)
- [ ] Measure time to completion
- [ ] Expected: Completes in <60 seconds
- [ ] UI remains responsive during editing

**Test 7.2: Rapid Requests**
- [ ] Send multi-file edit request
- [ ] Immediately send another request (spam)
- [ ] Expected: First request cancels, second starts
- [ ] No crashes or hanging

---

### 8. User Experience

**Test 8.1: Readability**
- [ ] Open multi-file diff
- [ ] Verify diffs are easy to read in Monaco
- [ ] Check syntax highlighting works
- [ ] Verify line numbers align

**Test 8.2: Tab Navigation**
- [ ] Open multi-file diff with 5 files
- [ ] Click through all tabs
- [ ] Verify smooth transitions
- [ ] No rendering glitches

**Test 8.3: Mobile/Responsive** (if applicable)
- [ ] Open on smaller screen
- [ ] Verify tabs don't overflow
- [ ] Verify buttons are accessible
- [ ] Check diff viewer is usable

---

## Regression Tests

Ensure existing features still work:

**Regression 1: Single-File Editing**
- [ ] Request single-file edit
- [ ] Verify DiffPanel still works
- [ ] Apply/discard still work

**Regression 2: Normal Chat**
- [ ] Ask question: "what files handle authentication?"
- [ ] Verify normal chat response
- [ ] No diffs proposed

**Regression 3: Scope Switching**
- [ ] Toggle scopes in header
- [ ] Request multi-file edit
- [ ] Verify only active scopes are used

**Regression 4: Stage Indicators**
- [ ] Request single-file edit
- [ ] Verify stage indicators still appear
- [ ] Check: finding, reading, thinking, done

---

## Known Issues

Document any bugs found during testing:

- [ ] Issue #1: ...
- [ ] Issue #2: ...
- [ ] Issue #3: ...

---

## Sign-Off

- [ ] All test cases passed
- [ ] No critical bugs found
- [ ] Performance acceptable
- [ ] UX feels smooth
- [ ] Ready for production

**Tester**: _______________
**Date**: _______________
**Notes**: _______________
