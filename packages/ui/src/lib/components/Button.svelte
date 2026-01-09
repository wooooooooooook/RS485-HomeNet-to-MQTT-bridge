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
    variant?: 'primary' | 'secondary' | 'danger' | 'success';
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
</script>

<button
  {type}
  class={`btn ${variant} ${className}`}
  class:loading={isLoading}
  class:full-width={fullWidth}
  {onclick}
  disabled={disabled || isLoading}
  aria-label={ariaLabel}
  aria-busy={isLoading}
  {title}
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
  }

  .full-width {
    width: 100%;
  }

  /* Primary Blue */
  .primary {
    background-color: #3b82f6;
  }
  .primary:hover:not(:disabled) {
    background-color: #2563eb;
  }

  /* Secondary - Outline */
  .secondary {
    background: transparent;
    color: #94a3b8;
    border: 1px solid #475569;
  }
  .secondary:hover:not(:disabled) {
    background: #334155;
    color: white;
  }

  /* Danger Red */
  .danger {
    background-color: #ef4444;
  }
  .danger:hover:not(:disabled) {
    background-color: #dc2626;
  }

  /* Success Green */
  .success {
    background-color: #10b981;
  }
  .success:hover:not(:disabled) {
    background-color: #059669;
  }

  .btn:disabled {
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
