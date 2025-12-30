<script lang="ts">
  import type { BridgeStatus } from '../types';
  import { t } from 'svelte-i18n';

  let {
    portIds,
    activePortId,
    portStatuses = [],
    showAddButton = false,
    onPortChange,
    onAddBridge,
  }: {
    portIds: string[];
    activePortId: string | null;
    portStatuses?: { portId: string; status: BridgeStatus | 'unknown'; message?: string }[];
    showAddButton?: boolean;
    onPortChange?: (portId: string) => void;
    onAddBridge?: () => void;
  } = $props();

  function getPortStatus(portId: string): BridgeStatus | 'unknown' {
    const portStatus = portStatuses.find(
      (p: { portId: string; status: BridgeStatus | 'unknown'; message?: string }) =>
        p.portId === portId,
    );
    return portStatus?.status ?? 'unknown';
  }
</script>

<div class="port-toolbar">
  <div class="port-tabs" aria-label={$t('dashboard.port_tabs_aria')}>
    {#if portIds.length === 0}
      <span class="hint">{$t('dashboard.no_configured_ports')}</span>
    {:else}
      {#each portIds as portId (portId)}
        <button
          class:active={activePortId === portId}
          type="button"
          onclick={() => onPortChange?.(portId)}
          data-state={getPortStatus(portId)}
        >
          {#if portStatuses.length > 0}
            <span class="port-status-dot"></span>
          {/if}
          {portId}
        </button>
      {/each}
    {/if}
    {#if showAddButton}
      <button
        class="add-bridge-btn"
        type="button"
        onclick={() => onAddBridge?.()}
        aria-label={$t('settings.bridge_config.add_button')}
      >
        +
      </button>
    {/if}
  </div>
</div>

<style>
  .port-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 1rem 0;
    flex-wrap: wrap;
  }

  .port-tabs {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .port-tabs button {
    padding: 0.5rem 0.9rem;
    border-radius: 10px;
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
    border: 1px solid rgba(148, 163, 184, 0.3);
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .port-status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #64748b;
    flex-shrink: 0;
  }

  .port-tabs button[data-state='started'] .port-status-dot {
    background-color: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
  }

  .port-tabs button[data-state='starting'] .port-status-dot {
    background-color: #f59e0b;
    animation: pulse 2s infinite;
  }

  .port-tabs button[data-state='error'] .port-status-dot {
    background-color: #ef4444;
  }

  .port-tabs button[data-state='stopped'] .port-status-dot {
    background-color: #64748b;
  }

  .port-tabs button.active {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.6);
    color: #bfdbfe;
    box-shadow: 0 4px 16px rgba(59, 130, 246, 0.25);
  }

  .port-tabs button:hover {
    border-color: rgba(148, 163, 184, 0.6);
  }

  .add-bridge-btn {
    padding: 0.5rem 0.8rem !important;
    background: rgba(30, 41, 59, 0.4) !important;
    border: 1px dashed rgba(148, 163, 184, 0.4) !important;
    color: #94a3b8 !important;
    font-size: 1.2rem;
    line-height: 1;
  }

  .add-bridge-btn:hover {
    border-color: #60a5fa !important;
    color: #60a5fa !important;
    background: rgba(59, 130, 246, 0.1) !important;
  }

  .hint {
    color: #94a3b8;
    font-style: italic;
  }

  @keyframes pulse {
    0% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
    100% {
      opacity: 1;
    }
  }
</style>
