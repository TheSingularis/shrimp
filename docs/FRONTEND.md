# SHRIMP Frontend Reference

Developer reference for the React frontend — CSS system, button classes, component patterns, and debugging.

For component hierarchy, data flow, and API communication see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## CSS Architecture

**Three-layer system:**
1. `frontend/src/index.css` — Tailwind import, CSS variables, global element resets, shared utility classes
2. `frontend/src/components/*.css` — Per-component styles (ChatPanel.css, ConversationSidebar.css, etc.)
3. Inline `style={{}}` — Dynamic values only (theme colors as variables, state-driven colors)

**Critical:** The global `button {}` rule in `index.css` resets all button styling and overrides Tailwind utilities. **Never use raw Tailwind padding/border utilities on `<button>` elements.** Always use one of the named button classes below.

---

## Themes & CSS Variables

Three themes, switched by setting `document.documentElement.className = 'theme-' + name`.

### Base Variables (shared across all themes)

| Variable | Value | Purpose |
|----------|-------|---------|
| `--bg` | `#0D0F17` | App background |
| `--surface` | `#161925` | Cards, panels, modals |
| `--surface2` | `#1E2231` | Nested surfaces |
| `--border` | `#252838` | Borders, dividers |
| `--text` | `#E8EAF0` | Primary text |
| `--text-muted` | `#8891A8` | Labels, metadata, hints |
| `--text-dim` | `#404669` | Placeholder, disabled |
| `--font-sans` | Inter, system-ui | UI text |
| `--font-mono` | IBM Plex Mono, Menlo | Code, monospace |

### Theme Accent Variables

| Variable | Purple (default) | Shrimp | Blue |
|----------|-----------------|--------|------|
| `--theme-primary` | `#8B5CF6` | `#FF6B6B` | `#3B82F6` |
| `--theme-primary-hover` | `#7C3AED` | `#EE5A5A` | `#2563EB` |
| `--theme-secondary` | `#A78BFA` | `#FFA07A` | `#60A5FA` |
| `--theme-accent-dim` | `#2E1F47` | `#332020` | `#1E293B` |

Theme class names: `.theme-blue-purple` `.theme-shrimp` `.theme-refined-blue`

### Status Colors (theme-independent)

| Variable | Color | Bg variable |
|----------|-------|-------------|
| `--color-success` | `#10b981` | `--color-success-bg` |
| `--color-error` | `#ef4444` | `--color--bg` |
| `--color-warning` | `#f59e0b` | `--color-warning-bg` |

**Always use CSS variables.** Never hardcode hex colors — they break theme switching.

---

## Button Classes

Every `<button>` must use one of these classes. Do not use raw Tailwind utilities on buttons.

### `btn-primary`
Accent border + text, transparent background. Fills with `accent-dim` on hover.  
**Use for:** Send, Save, primary modal confirm actions.
```tsx
<button className="btn-primary">Send</button>
```

### `btn-secondary`
Muted border + text at rest. Accent tint bg + accent text on hover.  
**Use for:** Reply, Forward, Run Now, Enable/Disable, Archive.  
Variants: `.danger` (red, destructive), `.active` (accent fill, for toggle groups).
```tsx
<button className="btn-secondary">Reply</button>
<button className="btn-secondary danger">Trash</button>
<button className="btn-secondary active">HTML</button>  {/* toggle group */}
```

### `btn-ghost`
No visual presence at rest (muted color, transparent bg). Subtle tint on hover.  
**Use for:** Back arrow, Flag/Star, Copy, utility Refresh.  
Variant: `.flagged` (amber, for active flag/star state).
```tsx
<button className="btn-ghost"><ArrowLeft size={16} /></button>
<button className={`btn-ghost${flagged ? " flagged" : ""}`}><Star size={14} /></button>
```

### `icon-btn`
Accent border + accent-dim background. More prominent than `btn-ghost`.  
**Use sparingly** — only for the most important header icon actions (Compose, Fetch emails).
```tsx
<button className="icon-btn"><Pencil size={13} /></button>
```

### `btn-card`
Surface bg + border. Lifts with accent tint on hover.  
**Use for:** QuickAction cards on the dashboard. Icon inside uses `card-icon` class.
```tsx
<button className="btn-card">
    <span className="card-icon"><Mail size={20} /></span>
    Open Inbox
</button>
```

### `btn-row`
No border, no bg, no padding. Full-width, theme-primary hover tint.  
**Use for:** Email list rows, conversation list items.
```tsx
<button className="btn-row">...</button>
```

### `nav-btn`
Transparent, 44×44px square. Active state uses accent-dim bg.  
**Use only** in the nav rail (`App.tsx`).

### `btn-bare`
No bg, border, or padding. Opacity 0.7 on hover.  
**Use for:** Icon buttons embedded inside other elements (search bar X, etc.).
```tsx
<button className="btn-bare"><X size={12} /></button>
```

### Disabled state
All classes support the native `disabled` attribute — opacity 0.4, cursor not-allowed.
```tsx
<button className="btn-primary" disabled>Sending…</button>
```

---

## Icons

Library: **Lucide React** (`lucide-react`). Import only icons you use.

### Size standards

| Size | Purpose |
|------|---------|
| 12–13px | Embedded tight spaces (btn-bare, icon-btn) |
| 14px | Compact inline actions, close buttons in tabs |
| 16px | Standard UI (default for most buttons) |
| 18px | Modal close buttons |
| 20px | Large touch targets, header buttons |

### Common icons

```tsx
import {
    Settings, X, Check, Edit3, RefreshCw,
    Loader2, Sparkles, ChevronLeft, ChevronRight,
    Mail, Star, ArrowLeft, Pencil
} from 'lucide-react';

<Loader2 size={16} className="spin" />  // loading spinner
<Sparkles size={16} />                  // AI/generate actions
<RefreshCw size={16} />                 // reload/sync
```

Icons inherit `currentColor`. Apply color via CSS variables:
```tsx
<Settings size={20} style={{ color: 'var(--text-muted)' }} />
```

The `.spin` animation class is defined globally in `index.css`.

---

## Component Patterns

### Status message
```tsx
<div className="p-2 rounded text-sm"
     style={{ color: 'var(--color-success)', background: 'var(--color-success-bg)' }}>
    Saved!
</div>
```
Replace `success` with `error` or `warning` for other states.

### Card
```css
background: var(--surface);
border: 1px solid var(--border);
border-radius: 8px;
padding: 1rem 1.5rem;
```
```tsx
<div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6">
    {/* content */}
</div>
```

### Input / Textarea
```tsx
<input
    className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)]
               bg-[var(--bg)] text-[var(--text)]
               focus:border-[var(--theme-primary)] focus:outline-none transition-colors"
/>
```

### Modal (centered)
```tsx
{/* Backdrop */}
<div className="fixed inset-0 bg-black/50 z-[100]" onClick={onClose} />

{/* Modal */}
<div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                max-w-[900px] w-[90%] max-h-[85vh]
                bg-[var(--surface)] border border-[var(--border)]
                rounded-lg z-[101] flex flex-col">
    <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--border)]">
        <h2 className="text-lg font-semibold">Title</h2>
        <button className="btn-bare" onClick={onClose}><X size={18} /></button>
    </div>
    <div className="flex-1 overflow-y-auto p-6">
        {/* scrollable content */}
    </div>
</div>
```

### Dashboard masonry grid
```css
/* Defined in index.css */
.dashboard-masonry {
    columns: 1;
    column-gap: 1.5rem;
}
@media (min-width: 1080px) { columns: 2; }
@media (min-width: 1650px) { columns: 3; }
```

---

## Typography & Spacing

**Font scale:**
```css
1.75rem  /* 28px — h1 */
1.25rem  /* 20px — h2 */
1.05rem  /* 17px — h3 */
0.95rem  /* 15px — body */
0.85rem  /* 14px — small */
0.75rem  /* 12px — tiny */
```

**Spacing scale** (0.25rem / 4px increments):
```
0.25rem =  4px   tight
0.5rem  =  8px   list gaps
0.75rem = 12px   section gaps
1rem    = 16px   standard padding
1.5rem  = 24px   modal padding
2rem    = 32px   large gaps
```

**Common patterns:**
- Button padding: `0.6rem 1.25rem`
- Card padding: `1rem 1.5rem`
- Between list items: `gap-2` (0.5rem)
- Between sections: `gap-4` (1rem)

---

## Design Rules

### Accent borders and border-radius
When an element has an accent border line (colored, for active/selected state), **do not round the corners on the side with the accent line** — it creates visual artifacts.

```css
/* ✅ Active tab with bottom accent */
.tab.active {
    border-bottom: 2px solid var(--theme-primary);
    border-radius: 0;
}

/* ✅ Card with left accent */
.card-with-left-accent {
    border-left: 3px solid var(--theme-primary);
    border-radius: 0 8px 8px 0;
}

/* ❌ Wrong — rounded corners conflict with accent border */
.tab.active {
    border-bottom: 2px solid var(--theme-primary);
    border-radius: 6px;
}
```

### Transitions
- `0.15s` — Input focus, quick hovers
- `0.2s` — Buttons, pills, most interactions
- `0.3s` — Drawers, modals, panels

### Responsive breakpoints
- Tablet: `max-width: 768px`
- Mobile: `max-width: 480px`
- Touch targets: minimum 44×44px

---

## Performance Debugging

### Frontend freezes (main thread blocking)

Common culprits and their status:

| Cause | Where | Status |
|-------|-------|--------|
| `JSON.parse()` on large sentinel data | `ChatPanel.tsx` | **Fixed** — offloaded to `run_in_executor` on backend |
| Monaco diff computation | `MultiFileDiffPanel.tsx` | **Fixed** — `DeferredDiffEditor` delays mount |
| Large React state updates | `setMultiFileEdit()` | **Fixed** — executor offloads JSON serialization |
| Backend file I/O blocking event loop | `main.py` | **Fixed** — uses `loop.run_in_executor` for file reads |

### Profiling with Chrome DevTools

1. **Performance tab** → Record → trigger the action → Stop
2. Look for long yellow/orange blocks in the flame graph (>50ms = long task, red triangle)
3. Common labels to watch: `JSON.parse`, `React`, `Monaco`

Quick timing in code:
```typescript
console.time('label');
// ... suspect operation ...
console.timeEnd('label');
```

Performance marks for DevTools:
```typescript
performance.mark('start');
// ... operation ...
performance.mark('end');
performance.measure('My Op', 'start', 'end');
console.table(performance.getEntriesByType('measure'));
```

Long task observer (add temporarily):
```typescript
new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
        if (entry.duration > 50)
            console.warn('Long task:', entry.duration + 'ms', entry);
    }
}).observe({ entryTypes: ['longtask'] });
```

### Expected performance targets
- Sentinel parse: < 50ms
- State update: < 10ms
- Monaco mount: < 100ms (async, no freeze)
- Diff computation: < 200ms (async)
- Total perceived delay for multi-file edit: ~300–400ms with spinner, no UI freeze
