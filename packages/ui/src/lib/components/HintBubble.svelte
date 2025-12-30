<script lang="ts">
  import { fade } from 'svelte/transition';
  let { onDismiss, children } = $props();
</script>

<div class="hint-bubble" transition:fade>
  <div class="content">
    {@render children()}
  </div>
  <button class="close-btn" onclick={onDismiss} aria-label="Dismiss">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  </button>
  <div class="arrow"></div>
</div>

<style>
  .hint-bubble {
    position: absolute;
    bottom: 100%;
    right: 0;
    margin-bottom: 12px;
    background: #3b82f6;
    color: white;
    padding: 0.5rem 2rem 0.5rem 1rem;
    border-radius: 6px;
    font-size: 0.85rem;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
    white-space: nowrap;
    z-index: 20;
    pointer-events: auto;
  }

  .arrow {
    position: absolute;
    bottom: -4px;
    right: 20px;
    transform: rotate(45deg);
    width: 8px;
    height: 8px;
    background: #3b82f6;
  }

  .close-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.8);
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    color: white;
  }

  .close-btn:focus-visible {
    outline: 2px solid white;
    outline-offset: -2px;
    border-radius: 4px;
  }
</style>
