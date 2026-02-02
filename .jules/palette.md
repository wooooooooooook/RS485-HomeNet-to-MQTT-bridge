## 2024-05-22 - [Accessible Modals Pattern]
**Learning:** Modals using `<dialog>` element often miss the connection between the dialog container and its title/description, making them less accessible to screen readers. Adding `aria-labelledby` and `aria-describedby` props to the reusable `Modal` component allows consumers to easily link these elements.
**Action:** When creating or updating Modal components, always expose props for ARIA labelling and ensure consuming components pass the IDs of their title and description elements. For generic Dialogs, auto-generating a unique ID for the title ensures accessibility by default.

## 2024-05-24 - [Empty State Controls]
**Learning:** Hiding control buttons (like "Start Recording") when a list is empty prevents users from initiating actions to populate that list, creating a dead end.
**Action:** Always ensure primary action buttons are visible regardless of data state. Use disabled states if an action is invalid, but keep the button visible if it's the entry point for the feature.

## 2024-05-25 - [Dynamic Accessible Labels]
**Learning:** Icon-only buttons that change state (like "Copy" -> "Copied") must update their `aria-label` and `title` to reflect the new state, otherwise screen reader users won't know the action succeeded.
**Action:** Always bind `aria-label` and `title` to the state variable (e.g., `isCopied ? 'Copied' : 'Copy'`) for stateful icon buttons.
