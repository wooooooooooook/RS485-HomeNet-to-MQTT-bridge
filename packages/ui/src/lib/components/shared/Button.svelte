<script lang="ts">
  export let variant: 'primary' | 'danger' = 'primary';
  export let disabled = false;
</script>

<button class={`btn ${variant}`} {disabled} on:click>
  <slot />
</button>

<style>
  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.25rem;
    cursor: pointer;
    font-weight: bold;
    transition: background-color 0.2s;
  }
  .primary {
    background-color: #3b82f6;
    color: white;
  }
  .primary:hover {
    background-color: #2563eb;
  }
  .danger {
    background-color: #ef4444;
    color: white;
  }
  .danger:hover {
    background-color: #dc2626;
  }
  .btn:disabled {
    background-color: #4b5563;
    cursor: not-allowed;
  }
</style>
