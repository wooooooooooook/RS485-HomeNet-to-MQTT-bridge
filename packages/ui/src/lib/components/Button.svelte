<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'primary',
    disabled = false,
    isLoading = false,
    ariaLabel = undefined,
    title = undefined,
    type = undefined,
    fullWidth = false,
    class: className = '',
    children,
    onclick,
  } = $props<{
    variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'outline-primary';
    disabled?: boolean;
    isLoading?: boolean;
    ariaLabel?: string;
    title?: string;
    type?: 'button' | 'submit' | 'reset';
    fullWidth?: boolean;
    class?: string;
    children?: Snippet;
    onclick?: (e: MouseEvent) => void;
  }>();

  function handleClick(e: MouseEvent) {
    if (disabled || isLoading) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    onclick?.(e);
  }

  // If a title is provided, we want it to be visible even when disabled.
  // Native 'disabled' attribute suppresses mouse events, preventing the title tooltip.
  // So we use aria-disabled only when title is present, allowing hover.
  // We also avoid native disabled for loading state to preserve focus.
  let useNativeDisabled = $derived(disabled && !title);
  let isDisabled = $derived(disabled || isLoading);
</script>

<button
  {type}
  class={`btn ${variant} ${className}`}
  class:loading={isLoading}
  class:full-width={fullWidth}
  onclick={handleClick}
  disabled={useNativeDisabled}
  aria-disabled={isDisabled}
  aria-label={ariaLabel}
  aria-busy={isLoading}
  {title}
  tabindex={disabled ? -1 : undefined}
>
  {#if isLoading}
    <span class="spinner" aria-hidden="true"></span>
    <span class="sr-only">Loading...</span>
  {/if}
  <span class="content" class:hidden={isLoading} aria-hidden={isLoading || undefined}>
    {@render children?.()}
  </span>
</button>

<style>
  .btn {
    position: relative;
    padding: 0.5rem 1rem;
    border-radius: 0.25rem;
    border: none;
    cursor: pointer;
    font-weight: 500;
    color: white;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
    font-family: inherit;
    font-size: 0.95rem;
    word-break: keep-all;
  }

  .full-width {
    width: 100%;
  }

  /* Primary Blue */
  .primary {
    background-color: #3b82f6;
  }
  .primary:hover:not(:disabled):not([aria-disabled='true']) {
    background-color: #2563eb;
  }

  /* Secondary - Outline */
  .secondary {
    background: transparent;
    color: #94a3b8;
    border: 1px solid #475569;
  }
  .secondary:hover:not(:disabled):not([aria-disabled='true']) {
    background: #334155;
    color: white;
  }

  /* Danger Red */
  .danger {
    background-color: #ef4444;
  }
  .danger:hover:not(:disabled):not([aria-disabled='true']) {
    background-color: #dc2626;
  }

  /* Success Green */
  .success {
    background-color: #10b981;
  }
  .success:hover:not(:disabled):not([aria-disabled='true']) {
    background-color: #059669;
  }

  /* Outline Primary (Execution style) */
  .outline-primary {
    padding: 0.5rem 1rem;
    border-radius: 8px;
    border: 1px solid rgba(59, 130, 246, 0.6);
    background: rgba(59, 130, 246, 0.2);
    color: #bfdbfe;
    font-weight: 600;
  }
  .outline-primary:hover:not(:disabled):not([aria-disabled='true']) {
    background: rgba(59, 130, 246, 0.3);
    border-color: rgba(59, 130, 246, 0.8);
    color: #eff6ff;
  }

  .btn:disabled,
  .btn[aria-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.6;
  }

  .spinner {
    width: 1em;
    height: 1em;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
    position: absolute;
    top: 50%;
    left: 50%;
    margin-top: -0.5em;
    margin-left: -0.5em;
  }

  .content {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    transition: opacity 0.2s;
  }

  .content.hidden {
    opacity: 0;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
