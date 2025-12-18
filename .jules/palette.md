## 2024-05-22 - [EntityDetail Tab Accessibility]
**Learning:** Adding ARIA roles to a div-based tab system significantly improves screen reader support without changing visual design.
**Action:** When creating tab interfaces in Svelte, always use 'role="tablist"', 'role="tab"', and 'role="tabpanel"' pattern.

## 2024-05-24 - [Modal Accessibility Standardization]
**Learning:** Modal dialogs like consent forms trap user interaction visually but require specific ARIA roles to trap focus and announce context to screen readers.
**Action:** Always add `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` to modal containers.

## 2024-05-27 - [Standardized Loading Buttons]
**Learning:** Replacing raw text-switching buttons with a standardized `Button` component that handles `isLoading` state (spinner + aria-busy) reduces code duplication and provides consistent feedback.
**Action:** When implementing async actions, use the enhanced `Button` component with the `isLoading` prop instead of manually managing button text.
