<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    variant = 'primary',
    disabled = false,
    children,
    onclick,
  } = $props<{
    variant?: 'primary' | 'danger';
    disabled?: boolean;
    children?: Snippet;
    onclick?: (e: MouseEvent) => void;
  }>();
</script>

<button class={`btn ${variant}`} {onclick} {disabled}>
  {@render children?.()}
</button>

<style>
  .btn {
    padding: 0.5rem 1rem;
    border-radius: 0.25rem;
    border: none;
    cursor: pointer;
    font-weight: bold;
    color: white;
  }

  .primary {
    background-color: #007bff;
  }

  .danger {
    background-color: #dc3545;
  }

  .btn:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
</style>
