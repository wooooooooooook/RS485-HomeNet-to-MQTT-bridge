## 2024-05-23 - Reusable Toggle Component
**Learning:** Replacing ad-hoc checkbox hacks with a semantic `<button role="switch">` component significantly improves accessibility (focus states, screen reader support) and code maintainability.
**Action:** When encountering custom checkbox-based toggles, refactor them into a reusable `Toggle` component that handles ARIA attributes and keyboard interaction centrally.

## 2024-12-31 - Optimistic UI for Controlled Toggles
**Learning:** When replacing native checkboxes with controlled `Toggle` components, users expect immediate visual feedback. Waiting for API round-trips makes the UI feel sluggish.
**Action:** Implement optimistic state updates (update local state immediately, revert on error) when using controlled components for network actions.
