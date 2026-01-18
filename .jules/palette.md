## 2024-05-23 - Accessibility Pattern for Form Hints
**Learning:** For inputs with helper text (hints), strictly using `<label>` is insufficient. Associating the hint text with the input using `aria-describedby` ensures screen reader users receive this context when focusing the input.
**Action:** Always add an `id` to hint elements and reference it via `aria-describedby` on the corresponding input field.

## 2024-05-24 - Editor Component Accessibility
**Learning:** Code or configuration editors (textareas) often lack visible labels to maximize screen real estate. This makes them inaccessible to screen readers.
**Action:** Use `aria-label` with a descriptive string (e.g. "Configuration Editor") and `aria-busy` for loading/saving states to ensure screen reader users understand the component's purpose and status.
