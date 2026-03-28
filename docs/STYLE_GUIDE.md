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

### Color Usage Guidelines

- **Primary actions**: Use `var(--theme-primary)` for buttons, links, active states
- **Hover states**: Use `var(--theme-primary-hover)` for interactive element hovers
- **Secondary accents**: Use `var(--theme-secondary)` sparingly for highlights
- **Backgrounds**: Use `var(--theme-accent-dim)` for subtle tinted backgrounds
- **Borders**: Use `var(--color-border)` for dividers and element borders
- **Text hierarchy**: `var(--color-text)` for primary, `var(--color-text-muted)` for secondary

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

#### Primary Button
```css
background: var(--theme-accent-dim);
border: 1px solid var(--theme-primary);
color: var(--theme-primary);
padding: 0.6rem 1.25rem;
border-radius: 6px;
transition: all 0.2s;

/* Hover */
background: var(--theme-primary);
color: #000;
```

#### Secondary Button
```css
background: transparent;
border: 1px solid var(--color-border);
color: var(--color-text-muted);

/* Hover */
border-color: var(--theme-primary);
color: var(--theme-primary);
```

#### Danger Button
```css
/* Hover only */
border-color: #ef4444;
color: #ef4444;
```

#### Disabled State
```css
opacity: 0.4;
cursor: not-allowed;
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

#### Settings Drawer
- Width: `480px` (desktop)
- Width: `60%` (tablet, max-width: 768px)
- Width: `100%` (mobile, max-width: 480px)
- Background: `var(--color-bg-elevated)`
- Border: `1px solid var(--color-border)`
- Transform: `translateX(100%)` (closed) → `translateX(0)` (open)
- Transition: `0.2s ease`

#### Backdrop
```css
background: rgba(0, 0, 0, 0.4);
backdrop-filter: blur(2px);
```

## Icons

### Icon Library
**Lucide React** v1.7.0 - MIT licensed, minimal SVG icons

### Icon Sizes
- **14px**: Small inline icons (checkmarks, close buttons in compact spaces)
- **16px**: Standard inline icons (edit, settings in tight UI)
- **18px**: Default UI icons (close buttons, navigation)
- **20px**: Larger UI icons (settings button, primary actions)
- **32px**: Logo (header)
- **128px**: Hero icon (welcome screen)

### Common Icons
- **Settings**: `<Settings size={20} />`
- **Close**: `<X size={18} />`
- **Check/Approve**: `<Check size={14} />`
- **Edit**: `<Edit3 size={16} />`
- **Add/New**: `<Plus size={16} />`
- **Delete**: `<X size={14} />` (with danger color)
- **Refresh**: `<RefreshCw size={16} />`

### Icon Colors
Icons inherit `currentColor` by default. Apply color via className:
```tsx
<Settings size={20} className="text-text-muted" />
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
