<script lang="ts">
  export let variant: 'primary' | 'danger' = 'primary';
  export let disabled = false;
</script>

<button class={`btn ${variant}`} on:click {disabled}>
  <slot />
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
