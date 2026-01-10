# Palette's Journal

## 2025-02-09 - Sidebar Navigation Interaction
**Learning:** In sidebar layouts, relying purely on visual cues for 'current page' state (like background color) is insufficient for screen readers. Explicit `aria-current="page"` is crucial but sometimes missed.
**Action:** Always verify `aria-current` on navigation links.

## 2025-02-09 - Button Accessibility
**Learning:** When using `isLoading` states on buttons, it's best to use `aria-busy` and visually hide the text while providing a screen-reader-only "Loading..." text to ensure users with assistive technology know what's happening.
**Action:** Use the `aria-busy` + `sr-only` text pattern for all async buttons.

## 2025-02-09 - Semantic Nesting in Interactive Cards
**Learning:** Placing heading elements (`<h3>`) inside `<button>` elements is invalid HTML and can confuse screen readers. The correct pattern for complex interactive cards is to use a `div` with `role="button"`, `tabindex="0"`, and manual keyboard handling (Enter/Space).
**Action:** When designing clickable cards with structured content (headers, titles), avoid `<button>` and use the ARIA button pattern instead.
