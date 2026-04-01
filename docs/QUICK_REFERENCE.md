# SHRIMP Quick Reference

Developer cheat sheet for common patterns, colors, and components. For comprehensive documentation, see [STYLE_GUIDE.md](./STYLE_GUIDE.md).

---

## Color Variables

### Base Colors (All Themes)

| Variable | Purpose | Value | Usage |
|----------|---------|-------|-------|
| `--bg` | Main background | `#0D0F17` | App background, dark surfaces |
| `--surface` | Elevated surfaces | `#161925` | Cards, panels, modals |
| `--border` | Borders & dividers | `#252838` | Element borders, separators |
| `--text` | Primary text | `#E8EAF0` | Main content, headings |
| `--text-muted` | Secondary text | `#8891A8` | Labels, metadata, hints |

### Theme Colors (Dynamic)

| Variable | Purple Theme | Shrimp Theme | Blue Theme |
|----------|-------------|--------------|------------|
| `--theme-primary` | `#8B5CF6` | `#FF6B6B` | `#3B82F6` |
| `--theme-primary-hover` | `#7C3AED` | `#EE5A5A` | `#2563EB` |
| `--theme-secondary` | `#A78BFA` | `#FFA07A` | `#60A5FA` |
| `--theme-accent-dim` | `#2E1F47` | `#332020` | `#1E293B` |

### Status Colors (Universal)

| Variable | Color | Usage |
|----------|-------|-------|
| `--color-success` | `#10b981` | Success messages, confirmations |
| `--color-success-bg` | `rgba(16, 185, 129, 0.1)` | Success backgrounds |
| `--color-error` | `#ef4444` | Errors, destructive actions |
| `--color-error-bg` | `rgba(239, 68, 68, 0.1)` | Error backgrounds |
| `--color-warning` | `#f59e0b` | Warnings, cautions |
| `--color-warning-bg` | `rgba(245, 158, 11, 0.1)` | Warning backgrounds |

---

## Icon Reference

### Icon Sizes

| Size | Purpose | Example Usage |
|------|---------|---------------|
| **14px** | Compact actions | Close buttons in tabs, tight rows |
| **16px** | Standard UI (default) | Most buttons, inline icons |
| **18px** | Modal close | Close buttons in modals |
| **20px** | Large touch targets | Header buttons, primary actions |

### Common Icons Cheat Sheet

```tsx
import {
    Settings, X, Check, Edit3, RefreshCw,
    Loader2, Sparkles, ChevronLeft, ChevronRight
} from 'lucide-react';

// Settings button
<Settings size={20} />

// Close/Cancel
<X size={14} />  {/* Compact */}
<X size={18} />  {/* Modal */}

// Refresh/Index
<RefreshCw size={16} />

// Loading spinner
<Loader2 size={16} className="spin" />

// Generate/AI action
<Sparkles size={16} />

// Navigation
<ChevronLeft size={16} />
<ChevronRight size={16} />
```

---

## Spacing System

**Rem Scale** (based on 16px):
- `0.25rem` = 4px (tight gaps)
- `0.5rem` = 8px (list item gaps)
- `0.75rem` = 12px (section gaps)
- `1rem` = 16px (standard padding/margins)
- `1.25rem` = 20px (section padding)
- `1.5rem` = 24px (modal padding)
- `2rem` = 32px (large spacing)
- `3rem` = 48px (page margins)

**Quick Usage:**
```css
padding: 1rem 1.5rem;  /* Vertical 16px, Horizontal 24px */
gap: 0.5rem;           /* 8px between items */
margin-top: 0.75rem;   /* 12px top margin */
```

---

## Component Patterns

### Button

```tsx
// Primary button
<button
    className="px-5 py-2.5 rounded-lg bg-[var(--theme-primary)] text-[var(--bg)]
               font-medium transition-opacity hover:opacity-85"
>
    Action
</button>

// Secondary button
<button
    className="px-5 py-2.5 rounded-lg border border-[var(--border)]
               text-[var(--text-muted)] transition-all
               hover:border-[var(--theme-primary)] hover:text-[var(--theme-primary)]"
>
    Cancel
</button>

// Danger button
<button
    className="px-5 py-2.5 rounded-lg border border-[var(--border)]
               text-[var(--text-muted)] transition-all
               hover:border-[var(--color-error)] hover:text-[var(--color-error)]"
>
    Delete
</button>
```

### Status Message

```tsx
// Success
<div className="p-2 rounded text-sm"
     style={{
         color: 'var(--color-success)',
         background: 'var(--color-success-bg)'
     }}>
    Operation successful!
</div>

// Error
<div className="p-2 rounded text-sm"
     style={{
         color: 'var(--color-error)',
         background: 'var(--color-error-bg)'
     }}>
    An error occurred
</div>

// Warning
<div className="p-2 rounded text-sm"
     style={{
         color: 'var(--color-warning)',
         background: 'var(--color-warning-bg)'
     }}>
    Proceed with caution
</div>
```

### Card

```css
background: var(--surface);
border: 1px solid var(--border);
border-radius: 8px;
padding: 1rem 1.5rem;
```

```tsx
<div className="bg-[var(--surface)] border border-[var(--border)]
                rounded-lg p-6">
    {/* Card content */}
</div>
```

### Input/Textarea

```tsx
<input
    type="text"
    className="w-full px-3 py-2.5 rounded-lg border border-[var(--border)]
               bg-[var(--bg)] text-[var(--text)]
               focus:border-[var(--theme-primary)] focus:outline-none
               transition-colors"
/>
```

### Pill/Badge

```tsx
<button
    className="px-4 py-2.5 rounded-lg border border-[var(--border)]
               text-[var(--text-muted)] font-mono text-sm
               transition-all
               hover:border-[var(--theme-primary)] hover:text-[var(--theme-primary)]
               [&.active]:bg-[var(--theme-accent-dim)]
               [&.active]:border-[var(--theme-primary)]
               [&.active]:text-[var(--theme-primary)]"
>
    Option
</button>
```

### Modal (Centered)

```tsx
// Backdrop
<div
    className="fixed inset-0 bg-black/50 z-[100]"
    onClick={onClose}
/>

// Modal container
<div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                max-w-[900px] w-[90%] max-h-[85vh]
                bg-[var(--surface)] border border-[var(--border)]
                rounded-lg z-[101] flex flex-col">

    {/* Header */}
    <div className="flex justify-between items-center
                    px-6 py-4 border-b border-[var(--border)]">
        <h2 className="text-lg font-semibold">Modal Title</h2>
        <button onClick={onClose}>
            <X size={18} />
        </button>
    </div>

    {/* Content (scrollable) */}
    <div className="flex-1 overflow-y-auto p-6">
        {/* Content here */}
    </div>
</div>
```

### Loading Spinner

```tsx
import { Loader2 } from 'lucide-react';

<Loader2 size={16} className="spin" />
```

**Required CSS:**
```css
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
.spin {
    animation: spin 1s linear infinite;
}
```

---

## Responsive Breakpoints

```css
/* Tablet and below */
@media (max-width: 768px) {
    /* Styles for tablets */
}

/* Mobile phones */
@media (max-width: 480px) {
    /* Styles for small phones */
}
```

**Common responsive patterns:**
```css
/* Desktop-first approach */
.container {
    width: 900px;
}

@media (max-width: 768px) {
    .container {
        width: 90%;
    }
}

@media (max-width: 480px) {
    .container {
        width: 95%;
    }
}
```

---

## Typography Quick Reference

```css
/* Headings */
font-size: 1.75rem;  /* 28px - h1 */
font-size: 1.5rem;   /* 24px - h2 */
font-size: 1.25rem;  /* 20px - h3 */

/* Body */
font-size: 0.95rem;  /* 15.2px - body */
font-size: 0.85rem;  /* 13.6px - small */
font-size: 0.75rem;  /* 12px - tiny */

/* Weights */
font-weight: 400;  /* Regular */
font-weight: 500;  /* Medium */
font-weight: 600;  /* Semibold */
font-weight: 700;  /* Bold */

/* Line heights */
line-height: 1.6;  /* Body text */
line-height: 1.3;  /* Headings */
line-height: 1.8;  /* Code blocks */
```

---

## Transition/Animation Reference

```css
/* Fast interactions */
transition: all 0.15s ease;

/* Standard UI changes */
transition: all 0.2s ease;

/* Slow/dramatic */
transition: all 0.3s ease;

/* Example usage */
.button {
    transition: opacity 0.2s ease, color 0.15s ease;
}
```

---

## Common CSS Patterns

### Flex Center
```css
display: flex;
align-items: center;
justify-content: center;
```

### Flex Column with Gap
```css
display: flex;
flex-direction: column;
gap: 0.75rem;
```

### Truncate Text
```css
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

### Smooth Hover Effect
```css
transition: all 0.2s ease;

&:hover {
    opacity: 0.85;
}
```

### Focus State (Inputs)
```css
&:focus {
    outline: none;
    border-color: var(--theme-primary);
}
```

---

## Pro Tips

1. **Always use CSS variables** instead of hardcoded colors for theme compatibility
2. **Test all 3 themes** (Purple, Shrimp, Blue) when adding colored UI
3. **Use status colors** (`--color-success/error/warning`) for semantic feedback
4. **Icon sizes**: 14px compact, 16px standard, 18px modals, 20px headers
5. **Spacing**: Use `0.5rem` increments for consistency
6. **Transitions**: 0.15s fast, 0.2s standard, 0.3s dramatic
7. **Mobile-first**: Test responsive breakpoints (768px, 480px)
8. **Accessibility**: Maintain WCAG AA contrast (7:1 for body text)

---

For complete documentation and examples, see [STYLE_GUIDE.md](./STYLE_GUIDE.md).
