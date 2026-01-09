## 2024-05-23 - Reusable Toggle Component
**Learning:** Replacing ad-hoc checkbox hacks with a semantic `<button role="switch">` component significantly improves accessibility (focus states, screen reader support) and code maintainability.
**Action:** When encountering custom checkbox-based toggles, refactor them into a reusable `Toggle` component that handles ARIA attributes and keyboard interaction centrally.

## 2024-12-31 - Optimistic UI for Controlled Toggles
**Learning:** When replacing native checkboxes with controlled `Toggle` components, users expect immediate visual feedback. Waiting for API round-trips makes the UI feel sluggish.
**Action:** Implement optimistic state updates (update local state immediately, revert on error) when using controlled components for network actions.

## 2024-05-24 - Accessibility of Placeholder-Only Inputs
**Learning:** Inputs that rely solely on `placeholder` text (like search boxes) are inaccessible to screen reader users who cannot perceive the placeholder as a label.
**Action:** Always add `aria-label` (using the same localized string as the placeholder if appropriate) to inputs that lack a visible `<label>` element.

## 2025-01-20 - Status Indicators for Screen Readers
**Learning:** Visual status indicators (like colored dots) are invisible to screen readers. Relying on `data-state` or color alone excludes blind users from knowing the system status.
**Action:** Always pair visual indicators with `aria-hidden="true"` and a complementary `.sr-only` span containing text that explicitly describes the status (e.g., "Running", "Error").

## 2024-05-21 - Accessible Loading Buttons
**Learning:** Simply hiding content visually (opacity: 0) during loading states is insufficient for screen readers, as they may still announce the hidden content along with the loading indicator (e.g., "Loading... Save").
**Action:** Use `aria-hidden="true"` on the visually hidden content wrapper when a loading spinner is present to ensure a clean auditory experience.
