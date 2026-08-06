# Design Guidelines: Restaurant Inventory & Recipe Costing Application

## Design Approach: Design System - Enterprise Productivity

**Selected System**: Custom design inspired by Linear + Stripe Dashboard patterns  
**Rationale**: This is a utility-focused, data-intensive operations tool requiring clarity, efficiency, and professional aesthetics. The design prioritizes scannable information, rapid data entry, and clear reporting over visual flair.

**Core Principles**:
- Information hierarchy through typography and spacing, not color
- Functional efficiency over decorative elements
- Consistent patterns for predictable interactions
- Professional appearance suitable for daily operational use

---

## Color Palette

### Light Mode
- **Background**: 0 0% 100% (white)
- **Surface**: 0 0% 98% (cards, elevated elements)
- **Border**: 240 6% 90% (subtle dividers)
- **Primary**: 24 100% 50% (pizza-inspired warm orange)
- **Primary Foreground**: 0 0% 100%
- **Secondary**: 240 5% 96% (neutral backgrounds)
- **Muted**: 240 5% 64% (supporting text)
- **Foreground**: 240 10% 4% (primary text)

### Dark Mode
- **Background**: 240 10% 4% (deep navy-black)
- **Surface**: 240 6% 10% (cards, elevated elements)
- **Border**: 240 4% 16% (subtle dividers)
- **Primary**: 24 100% 50% (consistent orange)
- **Primary Foreground**: 0 0% 100%
- **Secondary**: 240 4% 16% (neutral backgrounds)
- **Muted**: 240 5% 64% (supporting text)
- **Foreground**: 0 0% 98% (primary text)

### Functional Colors
- **Success**: 142 76% 36% (inventory received, positive variance)
- **Warning**: 38 92% 50% (low stock alerts)
- **Destructive**: 0 84% 60% (negative variance, waste)
- **Info**: 217 91% 60% (neutral information)

---

## Typography

**Font Stack**: Inter (Google Fonts) for UI, JetBrains Mono for numerical data

### Hierarchy
- **Display (H1)**: 36px / 2.25rem, font-weight 700, tracking-tight
- **Page Title (H2)**: 30px / 1.875rem, font-weight 600
- **Section Header (H3)**: 24px / 1.5rem, font-weight 600
- **Subsection (H4)**: 20px / 1.25rem, font-weight 600
- **Body Large**: 16px / 1rem, font-weight 400, leading-relaxed
- **Body**: 14px / 0.875rem, font-weight 400, leading-normal
- **Small**: 12px / 0.75rem, font-weight 400, uppercase tracking-wide for labels
- **Monospace Data**: 14px / 0.875rem, JetBrains Mono for costs, quantities, SKUs

---

## Layout System

**Spacing Scale**: Tailwind units of 2, 4, 6, 8, 12, 16 (focus on 4, 8, 16 for consistency)

### Page Structure
- **Sidebar Navigation**: w-64 (256px) fixed left, full height
- **Main Content**: Responsive with max-width constraints
  - Tables/Lists: max-w-full
  - Forms: max-w-3xl centered
  - Reports: max-w-7xl
- **Content Padding**: px-8 py-6 on desktop, px-4 py-4 on mobile
- **Card Spacing**: gap-6 between cards, p-6 internal padding
- **Section Spacing**: mb-12 between major sections

---

## Component Library

### Navigation
- **Sidebar**: Fixed left navigation with grouped menu items, icons from Heroicons (outline style)
- **Top Bar**: Sticky header with breadcrumbs, user menu, and quick actions
- **Tabs**: Underline variant for section switching within pages

### Data Display
- **Tables**: Striped rows, hover states, sticky headers for long lists, sortable columns
- **Cards**: Elevated shadow-sm, rounded-lg, with clear headers and action buttons in top-right
- **Stats Tiles**: Grid of 3-4 metrics with large numbers, small labels, trend indicators
- **Badge System**: Pill-shaped status indicators (Active, Pending, Received, etc.)

### Forms & Input
- **Text Inputs**: Consistent height (h-10), clear focus rings, inline validation
- **Search Bars**: Prominent with icon prefix, autocomplete dropdowns
- **Selects**: Custom styled to match input aesthetic, searchable for long lists
- **Unit Converter Input**: Compound input with quantity + unit selector side-by-side
- **QR/Barcode Scanner**: Full-width button with camera icon, modal scan interface

### Data Entry
- **Inventory Count Lines**: Repeatable row component with product search, qty input, unit selector, auto-calculated micro-units display
- **Recipe Component Editor**: Drag-to-reorder rows, nested indentation for sub-recipes, inline cost calculations
- **PO Line Items**: Grid layout with vendor SKU, ordered quantity, unit, price columns

### Reporting
- **Variance Table**: Multi-column with color-coded variance indicators, expandable rows for detail
- **Cost Breakdown**: Tree-view for nested recipe costs, indented hierarchy
- **Chart Cards**: Minimal bar/line charts using Recharts library, muted colors except highlights

### Overlays
- **Modals**: Centered, max-w-2xl, clear close button, footer action buttons
- **Dropdowns**: Shadow-lg, rounded-md, max height with scroll
- **Toasts**: Top-right notifications, auto-dismiss, contextual colors

---

## Animation & Interactions

**Principle**: Minimal, purposeful motion only

- **Page Transitions**: None (instant navigation)
- **Hover States**: Subtle opacity or background color shifts (150ms ease)
- **Focus States**: Clear ring-2 ring-primary with offset
- **Loading States**: Spinner for async actions, skeleton screens for table loading
- **Success Feedback**: Brief green flash on save actions, toast notification

---

## Restaurant Theme Integration

**Subtle Contextual Theming** (NOT customer-facing pizzeria branding):
- Orange accent color references pizza/warmth without being overpowering
- Food photography optional in empty states only ("No recipes yet" illustrations)
- Professional kitchen operation aesthetic, not dining room
- Icons: Use standard business icons (not pizza slices or chef hats)

---

## Page-Specific Layouts

### Inventory Count Screen
- Left: Storage location selector (vertical tabs)
- Center: Search bar + QR scan button
- Main: Data table with inline editing, quick-add row at bottom
- Right sidebar: Count summary stats

### Recipe Management
- List view: Card grid with recipe image, name, yield, cost
- Detail view: Two-column (components list left, cost breakdown right)
- BOM Editor: Nested tree structure with expand/collapse

### Variance Report
- Top: Period selector + filters (product, location)
- Stats row: Total variance, top gainers/losers
- Main: Sortable table with sparkline trend columns
- Export actions in header

---

## Accessibility & Performance

- Maintain WCAG AA contrast ratios (4.5:1 text, 3:1 UI components)
- Consistent dark mode across ALL inputs, tables, and form fields
- Keyboard navigation for all data entry workflows
- Screen reader labels for icon-only buttons
- Lazy load report data tables for large datasets