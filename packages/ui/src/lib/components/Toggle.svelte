<script lang="ts">
  let {
    checked = false,
    label = '',
    id = undefined,
    disabled = false,
    onchange,
  }: {
    checked: boolean;
    label?: string;
    id?: string;
    disabled?: boolean;
    onchange?: (checked: boolean) => void;
  } = $props();

  const uniqueId = `toggle-${Math.random().toString(36).slice(2, 9)}`;
  const elementId = $derived(id || uniqueId);
  const labelId = $derived(`${elementId}-label`);
</script>

<div class="toggle-wrapper" class:disabled>
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    id={elementId}
    class="toggle-switch"
    {disabled}
    onclick={() => onchange?.(!checked)}
    aria-labelledby={label ? labelId : undefined}
    aria-label={!label ? 'Toggle' : undefined}
  >
    <span class="slider"></span>
  </button>
  {#if label}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <label
      id={labelId}
      for={elementId}
      class="toggle-label"
      onclick={() => !disabled && onchange?.(!checked)}
    >
      {label}
    </label>
  {/if}
</div>

<style>
  .toggle-wrapper {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
  }

  .toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    background: #334155;
    border-radius: 12px;
    border: none;
    cursor: pointer;
    transition: background-color 0.2s;
    padding: 0;
    flex-shrink: 0;
  }

  .toggle-switch:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
  }

  .toggle-switch[aria-checked='true'] {
    background-color: #3b82f6;
  }

  .slider {
    position: absolute;
    height: 18px;
    width: 18px;
    left: 3px;
    top: 3px;
    background-color: white;
    border-radius: 50%;
    transition: transform 0.2s;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  .toggle-switch[aria-checked='true'] .slider {
    transform: translateX(20px);
  }

  .toggle-label {
    cursor: pointer;
    user-select: none;
    color: #e2e8f0;
    font-size: 0.95rem;
  }

  .disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .disabled .toggle-switch,
  .disabled .toggle-label {
    cursor: not-allowed;
  }
</style>
