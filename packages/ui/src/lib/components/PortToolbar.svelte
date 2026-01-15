<script lang="ts">
  import type { BridgeStatus } from '../types';
  import { t } from 'svelte-i18n';
  import HintBubble from './HintBubble.svelte';

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

  let errorBubblePortId = $state<string | null>(null);

  function getPortStatus(portId: string): BridgeStatus | 'unknown' {
    const portStatus = portStatuses.find(
      (p: { portId: string; status: BridgeStatus | 'unknown'; message?: string }) =>
        p.portId === portId,
    );
    return portStatus?.status ?? 'unknown';
  }

  function getPortErrorMessage(portId: string): string | undefined {
    const portStatus = portStatuses.find(
      (p: { portId: string; status: BridgeStatus | 'unknown'; message?: string }) =>
        p.portId === portId,
    );
    return portStatus?.message;
  }

  function handlePortClick(portId: string) {
    const status = getPortStatus(portId);
    const errorMessage = getPortErrorMessage(portId);

    // 에러 상태이고 에러 메시지가 있으면 버블 토글
    if (status === 'error' && errorMessage) {
      if (errorBubblePortId === portId) {
        errorBubblePortId = null;
      } else {
        errorBubblePortId = portId;
      }
    } else {
      errorBubblePortId = null;
    }

    // 항상 포트 변경 콜백 호출
    onPortChange?.(portId);
  }
</script>

<div class="port-toolbar">
  <div class="port-tabs" aria-label={$t('dashboard.port_tabs_aria')}>
    {#if portIds.length === 0}
      <span class="hint">{$t('dashboard.no_configured_ports')}</span>
    {:else}
      {#each portIds as portId (portId)}
        <div class="port-button-wrapper">
          <button
            class:active={activePortId === portId}
            type="button"
            onclick={() => handlePortClick(portId)}
            data-state={getPortStatus(portId)}
            aria-current={activePortId === portId ? 'true' : undefined}
            title={$t(`common.status.${getPortStatus(portId)}`)}
          >
            {#if portStatuses.length > 0}
              <span class="port-status-dot" aria-hidden="true"></span>
              <span class="sr-only">{$t(`common.status.${getPortStatus(portId)}`)}</span>
            {/if}
            {portId}
          </button>
          {#if errorBubblePortId === portId && getPortErrorMessage(portId)}
            <HintBubble
              variant="error"
              onDismiss={() => (errorBubblePortId = null)}
              autoCloseMs={3000}
            >
              <span class="error-message">{getPortErrorMessage(portId)}</span>
            </HintBubble>
          {/if}
        </div>
      {/each}
    {/if}
    {#if showAddButton}
      <button
        class="add-bridge-btn"
        type="button"
        onclick={() => onAddBridge?.()}
        aria-label={$t('settings.bridge_config.add_button')}
        title={$t('settings.bridge_config.add_button')}
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

  .port-button-wrapper {
    position: relative;
  }

  .error-message {
    color: #fca5a5;
    font-weight: 500;
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

  .port-tabs button[data-state='reconnecting'] .port-status-dot {
    background-color: #f59e0b;
    animation: pulse 1s infinite;
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

  .port-tabs button:focus-visible {
    outline: 2px solid #3b82f6;
    outline-offset: 2px;
    z-index: 10;
  }

  .add-bridge-btn {
    padding: 0.5rem 0.8rem !important;
    background: rgba(30, 41, 59, 0.4) !important;
    border: 1px dashed rgba(148, 163, 184, 0.4) !important;
    color: #94a3b8 !important;
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
