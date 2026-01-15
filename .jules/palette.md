## 2024-05-23 - Accessibility Pattern for Form Hints
**Learning:** For inputs with helper text (hints), strictly using `<label>` is insufficient. Associating the hint text with the input using `aria-describedby` ensures screen reader users receive this context when focusing the input.
**Action:** Always add an `id` to hint elements and reference it via `aria-describedby` on the corresponding input field.
