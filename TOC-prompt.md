# TOC: Fix Styling, Responsiveness, and Accessibility

## Type

Bug / Improvement

## Priority

High

## Summary

The Table of Contents (TOC) component has multiple styling, responsiveness, and accessibility defects across both mobile and desktop viewports. It needs to be sticky, scrollable, responsive, keyboard/screen-reader accessible, and touch-friendly on all devices, with corrected desktop styling (indentation, width, header). The TOC should also minimize to a compact header bar when the user scrolls, then expand on interaction.

## Components

- `tools2025/style.css`
- `tools2025/tools2026-consolidated.js`

## Description

The TOC component currently fails to meet usability and accessibility standards on both mobile and desktop. Issues span layout behavior (sticky positioning, scrollability, minimize-on-scroll), visual styling (indentation, width, header), and accessibility (keyboard navigation, screen reader support, touch targets). When the user scrolls past the TOC, it should collapse into a compact, sticky header bar showing only the TOC title. Clicking or tapping the collapsed header bar re-expands the full TOC. This minimize/expand behavior must work on both mobile and desktop, with smooth CSS transitions and proper ARIA state management (`aria-expanded`).

## Acceptance Criteria

### Mobile

- [ ] TOC is sticky and remains visible while scrolling
- [ ] TOC minimizes to a compact TOC Header bar when the user scrolls past it
- [ ] TOC is scrollable when content overflows
- [ ] TOC is responsive and adapts to mobile viewport widths
- [ ] TOC is navigable via keyboard (Tab, Enter, Arrow keys)
- [ ] TOC is accessible via screen reader (proper ARIA roles/labels, semantic markup)
- [ ] TOC has touch-friendly tap targets (minimum 44×44px)

### Desktop — Styling

- [ ] TOC header is visually stylized (font, color, weight consistent with myTech.Today theme)
- [ ] Nested TOC items are indented to reflect heading hierarchy
- [ ] TOC items have proper left indentation (not flush-left)
- [ ] TOC max-width is 300px on desktop

### Desktop — Behavior & Accessibility

- [ ] TOC minimizes to a compact TOC Header bar when the user scrolls past it
- [ ] TOC is scrollable when content exceeds available height
- [ ] TOC is sticky and remains visible while scrolling
- [ ] TOC is navigable via keyboard (Tab, Enter, Arrow keys)
- [ ] TOC is accessible via screen reader (proper ARIA roles/labels, semantic markup)
- [ ] TOC has touch-friendly interaction targets

### Minimize/Expand — Shared (Mobile & Desktop)

- [ ] Collapsed header bar displays TOC title and a toggle indicator (e.g., chevron icon)
- [ ] Clicking or tapping the collapsed header bar re-expands the full TOC
- [ ] Collapse/expand uses a smooth CSS transition (e.g., `max-height` or `transform`)
- [ ] Collapsed state uses `aria-expanded="false"`; expanded state uses `aria-expanded="true"`
- [ ] Toggle is keyboard-accessible (Enter/Space to expand/collapse)
- [ ] Collapsed header bar remains sticky at the top of the viewport
- [ ] Scroll position detection triggers collapse when TOC scrolls out of its natural position

## Technical Notes

- CSS changes go in `tools2025/style.css` (single shared CSS file per project rules)
- JS changes go in `tools2025/tools2026-consolidated.js` (single shared JS file per project rules)
- Use `position: sticky` for sticky behavior
- Use `overflow-y: auto` with a `max-height` for scrollability
- Use `role="navigation"` and `aria-label="Table of Contents"` for screen reader support
- Ensure nested `<ul>`/`<ol>` elements have incremental `padding-left` for indentation
- **Minimize-on-scroll**: Use `IntersectionObserver` or scroll event listener to detect when the TOC leaves its natural viewport position, then toggle a `.toc-collapsed` CSS class
- **Collapse transition**: Use `max-height` transition (e.g., `max-height: 0` when collapsed, `max-height: 80vh` when expanded) with `overflow: hidden` and `transition: max-height 0.3s ease`
- **ARIA state**: Toggle `aria-expanded` on the TOC header button element when collapsing/expanding
- **Collapsed header bar**: Style `.toc-collapsed .toc-header` as a fixed-height bar (e.g., `48px`) with the TOC title and a chevron indicator
- Test across Chrome, Firefox, Safari, and Edge on both mobile and desktop

## Labels

`TOC`, `accessibility`, `responsive`, `styling`, `tools2025`
