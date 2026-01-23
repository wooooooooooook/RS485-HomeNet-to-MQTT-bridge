## 2024-05-23 - Accessibility Pattern for Form Hints
**Learning:** For inputs with helper text (hints), strictly using `<label>` is insufficient. Associating the hint text with the input using `aria-describedby` ensures screen reader users receive this context when focusing the input.
**Action:** Always add an `id` to hint elements and reference it via `aria-describedby` on the corresponding input field.

## 2024-05-24 - Editor Component Accessibility
**Learning:** Code or configuration editors (textareas) often lack visible labels to maximize screen real estate. This makes them inaccessible to screen readers.
**Action:** Use `aria-label` with a descriptive string (e.g. "Configuration Editor") and `aria-busy` for loading/saving states to ensure screen reader users understand the component's purpose and status.

## 2026-01-19 - Tooltips on Disabled Buttons
**Learning:** The native `disabled` attribute on buttons suppresses mouse events in most browsers, preventing `title` tooltips from appearing. Users often need to know *why* a button is disabled.
**Action:** Use `aria-disabled="true"` instead of the `disabled` attribute when a tooltip explanation is required. Ensure click handlers manually check the disabled state and prevent action.

## 2026-01-20 - Hiding Decorative Text Icons
**Learning:** Text-based icons (like `✓` or `!`) are often read as random characters or punctuation by screen readers, creating noise.
**Action:** Use `aria-hidden="true"` on decorative text icons when the surrounding text already conveys the meaning (e.g. "Success" message next to a checkmark).
