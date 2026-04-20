# Performance Debugging Guide

## Tracking Frontend Freezes

The frontend (browser) and backend (FastAPI) run on separate processes. If the browser freezes or shows "Page Unresponsive", the issue is on the frontend main thread.

### Chrome DevTools Performance Profiler

**Best method for identifying what's blocking the main thread:**

1. **Open DevTools** → Performance tab
2. **Start recording** (red circle button)
3. **Trigger the freeze** (e.g., send message that causes multi-file edit)
4. **Stop recording** when freeze ends
5. **Analyze the flame graph**:
   - Look for long yellow/orange blocks (indicates blocking JavaScript)
   - Long blocks = main thread blocked
   - Click on blocks to see which function caused it

**What to look for:**
- Large blocks labeled `JSON.parse` → parsing large sentinel data
- Large blocks labeled `React` → expensive re-renders
- Large blocks labeled `Monaco` → editor initialization/diff computation
- Long tasks (red triangles) indicate >50ms blocking operations

### 2. Performance Marks (Add to Code)

Add performance markers around suspected operations:

```typescript
// In ChatPanel.tsx, around setMultiFileEdit:
performance.mark('sentinel-parse-start');
const { display, sentinel } = parseSentinel(fullResponse);
performance.mark('sentinel-parse-end');
performance.measure('Sentinel Parsing', 'sentinel-parse-start', 'sentinel-parse-end');

performance.mark('state-update-start');
setMultiFileEdit(sentinel);
performance.mark('state-update-end');
performance.measure('State Update', 'state-update-start', 'state-update-end');

// View in console
console.table(performance.getEntriesByType('measure'));
```

### 3. Console Timing (Quick Check)

```typescript
console.time('Sentinel Parse');
const { display, sentinel } = parseSentinel(fullResponse);
console.timeEnd('Sentinel Parse');

console.time('State Update');
setMultiFileEdit(sentinel);
console.timeEnd('State Update');
```

### 4. React DevTools Profiler

1. Install React DevTools extension
2. Open DevTools → Profiler tab
3. Click record button
4. Trigger freeze
5. Stop recording
6. See which components took longest to render

### 5. Browser Task Monitoring

Add to ChatPanel.tsx:

```typescript
// Monitor long tasks
if ('PerformanceObserver' in window) {
    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            if (entry.duration > 50) { // Long task threshold
                console.warn('Long task detected:', entry.duration + 'ms', entry);
            }
        }
    });
    observer.observe({ entryTypes: ['longtask'] });
}
```

## Common Culprits for Freezes

### JSON.parse() on Large Data
- Sentinel with multiple large files
- **Fix**: Stream data or split into chunks

### React State Updates with Large Data
- Setting state with MB of file content
- **Fix**: Use useDeferredValue or split updates

### Monaco Editor Initialization
- Synchronous diff computation
- **Fix**: Already implemented (DeferredDiffEditor)

### Synchronous File Reading (Backend)
- Backend blocks event loop during file I/O
- **Fix**: Already implemented (run_in_executor)

## Testing Freeze Fixes

1. **Clear browser cache** (hard refresh: Ctrl+Shift+R)
2. **Open Performance tab**
3. **Record during multi-file edit**
4. **Check for blocks >50ms**:
   - Before fixes: Should see large blocking operations
   - After fixes: Should see smaller, non-blocking operations

## Expected Performance

With all optimizations:
- Sentinel parsing: <50ms
- State update: <10ms
- Monaco mount: <100ms (async)
- Diff computation: <200ms (async)
- Total perceived delay: ~300-400ms with spinners, no freeze

## When to Profile

Profile when:
- Browser shows "Page Unresponsive" dialog
- UI becomes unresponsive to clicks
- Animations stutter or stop
- DevTools shows warnings about long tasks

Don't profile:
- Network delays (backend processing)
- Loading spinners (expected async work)
- Smooth animations (not a freeze)
