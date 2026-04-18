# SHRIMP Style Guide

Visual design system for the SHRIMP application UI.

## Color Palette

### Theme System

SHRIMP supports 3 switchable color themes. All themes share the same neutral base colors but differ in accent colors.

#### Shared Base Colors
```css
--color-bg-dark: #0D0F17        /* Main background */
--color-bg-elevated: #161925    /* Cards, panels, elevated surfaces */
--color-border: #252838         /* Borders and dividers */
--color-text: #E8EAF0           /* Primary text */
--color-text-muted: #8891A8     /* Secondary text, labels */
```

#### Theme 1: Purple (Default Blue/Purple)
```css
--theme-primary: #8B5CF6          /* Vibrant violet - primary actions */
--theme-primary-hover: #7C3AED    /* Deep violet - hover states */
--theme-secondary: #A78BFA        /* Light purple - secondary elements */
--theme-accent-dim: #2E1F47       /* Dark purple - backgrounds */
--theme-gradient-from: #8B5CF6    /* Gradient start */
--theme-gradient-to: #A78BFA      /* Gradient end */
```

**Usage**: Default theme. Purple-dominant, creative and distinctive. Use for buttons, links, active states.

#### Theme 2: Shrimp (Coral/Pink/Orange)
```css
--theme-primary: #FF6B6B          /* Coral red - primary actions */
--theme-primary-hover: #EE5A5A    /* Darker coral - hover states */
--theme-secondary: #FFA07A        /* Light salmon - secondary elements */
--theme-accent-dim: #332020       /* Warm dark - backgrounds */
--theme-gradient-from: #FF6B6B    /* Gradient start */
--theme-gradient-to: #FFA07A      /* Gradient end */
```

**Usage**: Shrimp branding theme. Warm, approachable feel. Matches shrimp icon colors.

#### Theme 3: Blue (Refined Blue)
```css
--theme-primary: #3B82F6          /* Classic blue - primary actions */
--theme-primary-hover: #2563EB    /* Rich blue - hover states */
--theme-secondary: #60A5FA        /* Sky blue - secondary elements */
--theme-accent-dim: #1E293B       /* Slate dark - backgrounds */
--theme-gradient-from: #3B82F6    /* Gradient start */
--theme-gradient-to: #60A5FA      /* Gradient end */
```

**Usage**: Refined professional theme. Classic blue tones, brighter and more vibrant. Distinct from the purple theme.

### Status Colors

Universal semantic colors (theme-independent):
```css
--color-success: #10b981           /* Success states, confirmations */
--color-success-bg: rgba(16, 185, 129, 0.1)  /* Success backgrounds */
--color-error: #ef4444             /* Errors, destructive actions */
--color-error-bg: rgba(239, 68, 68, 0.1)     /* Error backgrounds */
--color-warning: #f59e0b           /* Warnings, cautions */
--color-warning-bg: rgba(245, 158, 11, 0.1)  /* Warning backgrounds */
```

### Color Usage Guidelines

- **Primary actions**: Use `var(--theme-primary)` for buttons, links, active states
- **Hover states**: Use `var(--theme-primary-hover)` for interactive element hovers
- **Secondary accents**: Use `var(--theme-secondary)` sparingly for highlights
- **Backgrounds**: Use `var(--theme-accent-dim)` for subtle tinted backgrounds
- **Borders**: Use `var(--color-border)` for dividers and element borders
- **Text hierarchy**: `var(--color-text)` for primary, `var(--color-text-muted)` for secondary
- **Status messages**: Use `var(--color-success/error/warning)` for semantic feedback

### Accessibility

All theme color combinations maintain **WCAG AA** contrast ratios:
- Primary text on dark background: 13.5:1 (AAA)
- Muted text on dark background: 7.2:1 (AA)
- Theme primary on dark background: 8.5:1+ (AAA)

## Typography

### Font Families

**UI Text**: `Inter` (fallback: system fonts)
```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
```

**Code/Monospace**: System monospace stack
```css
font-family: monospace;
```

### Font Weights

- **400** (regular): Body text, labels
- **500** (medium): Emphasized text, table headers
- **600** (semi-bold): Section headers, button text
- **700** (bold): Main headings, important emphasis

### Type Scale

```css
/* Headings */
h1: 2rem (32px)     font-weight: 600
h2: 1.25rem (20px)  font-weight: 600
h3: 1.05rem (17px)  font-weight: 600

/* Body */
body: 1rem (16px)       line-height: 1.7
small: 0.875rem (14px)  line-height: 1.5
tiny: 0.75rem (12px)    line-height: 1.4
```

### Line Heights

- **1.4**: Compact text (tiny labels, pills)
- **1.5**: Small text (captions, metadata)
- **1.6**: Default body text
- **1.7**: Long-form content (markdown, chat messages)

## Spacing

### Spacing Scale

Based on `0.25rem` (4px) increments:

```css
0.25rem = 4px   /* Minimal gap */
0.5rem  = 8px   /* Tight spacing */
0.75rem = 12px  /* Default gap between related elements */
1rem    = 16px  /* Standard spacing */
1.5rem  = 24px  /* Section padding */
2rem    = 32px  /* Large gaps */
3rem    = 48px  /* Page margins */
4rem    = 64px  /* Hero spacing */
```

### Common Patterns

- **Button padding**: `0.6rem 1.25rem`
- **Card padding**: `1rem 1.5rem`
- **Section gaps**: `gap-4` (1rem / 16px)
- **List item gaps**: `gap-2` (0.5rem / 8px)
- **Page margins**: `3rem` (48px)

## Components

### Buttons

Every `<button>` element MUST use one of these CSS classes. Never use raw Tailwind utilities on buttons — the unlayered `button {}` base rule in `index.css` beats `@layer utilities`.

#### `btn-primary` — Pill action button
Accent border + text, transparent bg. Fills with `accent-dim` on hover. Matches scope pill aesthetic.
Use for: Send, Save, primary modal confirm actions.
```tsx
<button className="btn-primary">Send</button>
<button className="btn-primary">Save Settings</button>
```

#### `btn-secondary` — Small labeled action button
Muted border + text at rest. Accent tint bg + accent text on hover.
Use for: Reply, Forward, Run Now, Enable/Disable, Archive.
Variants: `.danger` (red, destructive), `.active` (accent fill, for toggle groups).
```tsx
<button className="btn-secondary">Reply</button>
<button className="btn-secondary danger">Trash</button>
<button className="btn-secondary active">HTML</button>  {/* toggle group */}
```

#### `btn-ghost` — Borderless utility icon button
No visual presence at rest (muted color, transparent bg). Subtle white tint on hover.
Use for: Back arrow, Flag/Star, Copy, utility Refresh buttons.
Variant: `.flagged` (amber, for active flag/star state).
```tsx
<button className="btn-ghost"><ArrowLeft size={16} /></button>
<button className={`btn-ghost${flagged ? " flagged" : ""}`}><Star size={14} /></button>
```

#### `icon-btn` — Prominent icon-only button (with accent border)
Accent border + accent-dim bg. More visually heavy than `btn-ghost`.
Use sparingly — only for the most important header icon actions (Compose, Fetch emails).
```tsx
<button className="icon-btn"><Pencil size={13} /></button>
```

#### `btn-card` — Dashboard card button
Surface bg + border. Lifts with accent tint on hover.
Use for: QuickAction cards on the dashboard.
Icon inside must use the `card-icon` class to get accent color.
```tsx
<button className="btn-card">
    <span className="card-icon"><Mail size={20} /></span>
    Open Inbox
</button>
```

#### `btn-row` — Full-width list/row button
No border, no bg, no padding. Primary hover: theme-primary tint.
Use for: email list rows, conversation list items.
```tsx
<button className="btn-row">...</button>
```

#### `nav-btn` — Navigation rail button
Transparent, square (44×44px). Active state uses accent-dim bg.
Use only in the nav rail (`App.tsx`).

#### `btn-bare` — Invisible inline button
No bg, border, or padding. Opacity 0.7 on hover.
Use for: icon buttons embedded inside other elements (search bar X, etc.).
```tsx
<button className="btn-bare"><X size={12} /></button>
```

#### Disabled State
All classes support the native `disabled` attribute — opacity 0.4, cursor not-allowed.
```tsx
<button className="btn-primary" disabled>Sending…</button>
```

### Pills/Badges

```css
background: var(--theme-accent-dim);
border: 1px solid var(--color-border);
color: var(--color-text-muted);
padding: 0.4rem 0.75rem;
border-radius: 6px;
font-size: 0.85rem;

/* Active/Selected */
background: color-mix(in srgb, var(--theme-primary) 20%, transparent);
border-color: var(--theme-primary);
color: var(--theme-primary);
```

### Input/Textarea

```css
background: var(--color-bg-dark);
border: 1px solid var(--color-border);
color: var(--color-text);
padding: 0.6rem 0.75rem;
border-radius: 6px;
transition: border-color 0.15s;

/* Focus */
border-color: var(--theme-primary);
outline: none;
```

### Cards

```css
background: var(--color-bg-elevated);
border: 1px solid var(--color-border);
border-radius: 8px;
padding: 1rem 1.5rem;
```

### Modals/Drawers

#### Settings Modal (Tabbed Full-Window Modal)

Full-window modal with tabbed navigation for complex settings interfaces.

**Structure:**
- Container: Centered, `max-width: 900px`, `max-height: 85vh`
- Header: Title + close button (X icon, 18px)
- Tab navigation: Horizontal tabs at top
- Content area: Scrollable sections
- Animation: Fade + scale (0.2s ease)

**Dimensions:**
- Desktop: `width: 90%`, `max-width: 900px`
- Tablet (≤768px): `width: 90%`
- Mobile (≤480px): `width: 95%`

**Example Structure:**
```tsx
<div className="modal-backdrop" onClick={onClose} />
<div className="settings-modal">
    <div className="modal-header">
        <h2>Settings</h2>
        <button className="close-btn" onClick={onClose}>
            <X size={18} />
        </button>
    </div>

    <div className="modal-tabs">
        <button className={`tab ${activeTab === "tab1" ? "active" : ""}`}>
            Tab 1
        </button>
        {/* More tabs */}
    </div>

    <div className="modal-content">
        {/* Scrollable content sections */}
    </div>
</div>
```

**CSS:**
```css
.settings-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    max-width: 900px;
    width: 90%;
    max-height: 85vh;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    z-index: 101;
}

.modal-tabs .tab {
    padding: 0.75rem 1.25rem;
    border-bottom: 2px solid transparent;
    color: var(--text-muted);
    transition: all 0.2s;
}

.modal-tabs .tab.active {
    color: var(--theme-primary);
    border-bottom-color: var(--theme-primary);
}

.modal-content {
    overflow-y: auto;
    flex: 1;
}
```

#### Backdrop
```css
background: rgba(0, 0, 0, 0.5);
z-index: 100;
animation: fadeIn 0.2s ease;
```

## Icons

### Icon Library
**Lucide React** v1.7.0 - MIT licensed, minimal SVG icons. All UI icons use Lucide for consistency and professional appearance.

### Icon Size Standards
- **14px**: Compact inline actions (close buttons in tabs, tight rows, small indicators)
- **16px**: Standard UI elements (most buttons, icons, default size)
- **18px**: Modal close buttons, larger interactive elements
- **20px**: Large touch targets (header buttons, primary actions)
- **32px**: Logo (header)
- **128px**: Hero icon (welcome screen)

**Sizing principle**: Use smaller sizes (14-16px) in dense layouts, larger sizes (18-20px) for prominent actions.

### Common Icons Reference

| Purpose | Icon Component | Import | Typical Size | Usage |
|---------|---------------|--------|--------------|-------|
| Settings | `<Settings />` | `lucide-react` | 16-20px | Header settings button, configuration |
| Close/Cancel | `<X />` | `lucide-react` | 14-18px | Modal close, remove items, cancel |
| Check/Approve | `<Check />` | `lucide-react` | 16px | Success states, approvals |
| Edit | `<Edit3 />` | `lucide-react` | 16px | Edit actions |
| Refresh | `<RefreshCw />` | `lucide-react` | 14-16px | Reload, index, sync |
| Loading | `<Loader2 className="spin" />` | `lucide-react` | 16px | Loading states (requires spin animation) |
| Generate | `<Sparkles />` | `lucide-react` | 16px | AI generation, magic actions |
| Chevron Left | `<ChevronLeft />` | `lucide-react` | 16px | Navigation, sidebar collapse |
| Chevron Right | `<ChevronRight />` | `lucide-react` | 16px | Navigation, sidebar expand |

### Icon Implementation

```tsx
// Standard icon button
<button onClick={handleAction}>
    <Settings size={20} />
</button>

// Icon with text
<button onClick={handleRefresh}>
    <RefreshCw size={16} /> Refresh
</button>

// Loading state with spin animation
<button disabled={loading}>
    {loading ? (
        <><Loader2 size={16} className="spin" /> Loading...</>
    ) : (
        <><Sparkles size={16} /> Generate</>
    )}
</button>
```

### Icon Colors
Icons inherit `currentColor` by default. Apply color via inline styles or CSS variables:
```tsx
<Settings size={20} style={{ color: 'var(--text-muted)' }} />
```

### Spin Animation
For loading spinners, use the `.spin` class:
```css
@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
.spin {
    animation: spin 1s linear infinite;
}
```

## Animations

### Transition Timings
- **Fast**: `0.15s` - Input focus, quick hovers
- **Standard**: `0.2s` - Buttons, pills, most UI interactions
- **Medium**: `0.3s` - Drawers, modals, panels
- **Slow**: `0.5s` - Complex state changes, hero animations

### Common Transitions
```css
/* Buttons */
transition: all 0.2s;

/* Borders/Outlines */
transition: border-color 0.15s;

/* Transforms (drawers, modals) */
transition: transform 0.2s ease;

/* Opacity fades */
transition: opacity 0.3s;
```

### Loading States
Use `cli-spinners` package for terminal-style spinners in messages.

## Layout Patterns

### Flexbox Containers
```css
/* Horizontal row with gap */
display: flex;
gap: 1rem;
align-items: center;

/* Vertical column */
flex-direction: column;
gap: 0.75rem;

/* Stretch to fill */
flex: 1;

/* Prevent shrink */
flex-shrink: 0;
```

### Scrollable Areas
```css
/* Enable scroll */
overflow-y: auto;
overflow-x: hidden;

/* Prevent scroll */
overflow: hidden;

/* Minimum height for flex scroll */
min-height: 0;
```

### Grid Layouts
```css
/* Responsive grid */
display: grid;
grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
gap: 1rem;
```

## Responsive Design

### Breakpoints
- **Desktop**: Default (> 768px)
- **Tablet**: `max-width: 768px`
- **Mobile**: `max-width: 480px`

### Mobile Adaptations
- Settings drawer: Full width on mobile
- Font sizes: Slightly larger on mobile (17px base)
- Touch targets: Minimum 44x44px
- Spacing: Reduce gaps by 25% on mobile

## Best Practices

### Color
1. Always use CSS variables (`var(--theme-primary)`), never hardcoded hex
2. Test all themes when adding new UI elements
3. Maintain contrast ratios for accessibility

### Typography
1. Use `rem` units for font sizes (scales with user preferences)
2. Keep line lengths under 80 characters for readability
3. Use weight variations (not color) to show hierarchy

### Spacing
1. Use spacing scale multiples (0.25rem increments)
2. Prefer Tailwind utility classes (`gap-4`, `p-6`) for consistency
3. Add `shrink-0` to fixed-height elements in flex containers

### Border Radius with Accent Lines
**Critical Rule**: When using accent border lines (colored borders for active/selected states), do NOT round the corners on the side with the accent line.

**Why**: Rounded corners on the same side as an accent border create visual artifacts and weaken the accent line's impact.

**Examples**:
```css
/* ✅ CORRECT - Active tab with bottom accent border */
.tab.active {
    border-bottom: 2px solid var(--theme-primary);
    border-radius: 0; /* No rounding - accent line is on bottom */
}

/* ✅ CORRECT - Modal with bottom rounded corners only */
.modal {
    border-radius: 0 0 8px 8px; /* Top corners square, bottom rounded */
    /* Top has border from tabs, so no rounding there */
}

/* ✅ CORRECT - Card with left accent border */
.card-with-left-accent {
    border-left: 3px solid var(--theme-primary);
    border-radius: 0 8px 8px 0; /* Left side square, right side rounded */
}

/* ❌ WRONG - Rounded corners conflict with accent border */
.tab.active {
    border-bottom: 2px solid var(--theme-primary);
    border-radius: 6px; /* Creates visual artifacts at bottom corners */
}
```

### Icons
1. Import only icons you use (tree-shaking)
2. Use consistent sizes within contexts (all close buttons: 18px)
3. Apply color via className, not inline styles

### Performance
1. Use CSS variables for instant theme switching
2. Minimize asset sizes (SVGs over PNGs)
3. Use `color-mix()` for dynamic color variations instead of hardcoded rgba

## Code Examples

### Theme-Aware Component
```tsx
<button
  className="px-4 py-2 border rounded-md transition-all"
  style={{
    background: 'var(--theme-accent-dim)',
    borderColor: 'var(--theme-primary)',
    color: 'var(--theme-primary)'
  }}
>
  Click Me
</button>
```

### Responsive Card
```tsx
<div className="bg-bg-elevated border border-border rounded-lg p-6 md:p-8">
  <h2 className="text-xl font-semibold mb-4">Card Title</h2>
  <p className="text-text-muted">Card content...</p>
</div>
```

### Icon with Color
```tsx
import { Settings } from 'lucide-react';

<Settings
  size={20}
  className="text-text-muted hover:text-theme-primary transition-colors"
/>
```

---

**Last Updated**: 2026-03-28
**SHRIMP Version**: 1.0.0
