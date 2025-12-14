<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { ToastMessage } from '../types';

  let { toasts = [] } = $props<{ toasts?: ToastMessage[] }>();

  const dispatch = createEventDispatcher<{ dismiss: { id: string } }>();

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return timestamp;
    }
  };

  const handleDismiss = (id: string) => {
    dispatch('dismiss', { id });
  };
</script>

{#if toasts.length > 0}
  <div class="toast-container">
    {#each toasts as toast (toast.id)}
      <button
        class={`toast ${toast.type}`}
        onclick={() => handleDismiss(toast.id)}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && handleDismiss(toast.id)}
      >
        <div class="toast-header">
          <div class="toast-title">{toast.title}</div>
          <div class="toast-time">{formatTimestamp(toast.timestamp)}</div>
        </div>
        <div class="toast-message">{toast.message}</div>
      </button>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column-reverse;
    gap: 0.5rem;
    z-index: 3000;
    width: min(420px, calc(100vw - 2rem));
    pointer-events: none;
  }

  .toast {
    background: rgba(15, 23, 42, 0.92);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-left-width: 3px;
    border-radius: 10px;
    padding: 0.6rem 0.9rem;
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.35);
    color: #f1f5f9;
    animation: enter 0.18s ease-out;
    cursor: pointer;
    pointer-events: auto;
    text-align: left;
    width: 100%;
    font-family: inherit;
  }

  .toast.state {
    border-left-color: #38bdf8;
  }

  .toast.command {
    border-left-color: #fbbf24;
  }

  .toast-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }

  .toast-title {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .toast-time {
    font-size: 0.75rem;
    color: #94a3b8;
  }

  .toast-message {
    font-size: 0.85rem;
    line-height: 1.3;
    color: #e2e8f0;
    word-break: break-word;
  }

  @keyframes enter {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
