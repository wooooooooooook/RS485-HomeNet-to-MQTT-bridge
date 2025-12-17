<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { BridgeStatus } from '../types';

  let {
    bridgeStatus = 'idle' as BridgeStatus,
    connectionStatus = 'idle' as 'idle' | 'connecting' | 'connected' | 'error',
    statusMessage,
    portStatuses = [],
  } = $props<{
    bridgeStatus: BridgeStatus;
    connectionStatus: 'idle' | 'connecting' | 'connected' | 'error';
    statusMessage: string;
    portStatuses?: { portId: string; status: BridgeStatus | 'unknown'; message?: string }[];
  }>();

  const dispatch = createEventDispatcher();

  const bridgeStatusLabels: Record<string, string> = {
    idle: '브리지를 준비하는 중입니다.',
    starting: '브리지를 시작하는 중입니다...',
    started: '브리지가 실행 중입니다.',
    stopped: '브리지가 중지되었습니다.',
    error: '브리지 오류가 발생했습니다.',
  };
</script>

<header class="header">
  <div class="left-section">
    <button
      class="ghost mobile-menu-btn"
      type="button"
      onclick={() => dispatch('toggleSidebar')}
      aria-label="메뉴 열기"
    >
      <span class="icon">☰</span>
    </button>

    <div class="logo">
      <span class="logo-icon">H</span>
      <span class="logo-text">Homenet2MQTT</span>
    </div>

    <div class="alpha-badge">ALPHA</div>
  </div>

  <div class="right-section">
    <div class="status-container">
      <div class="status-item port-statuses">
        {#if portStatuses.length === 0}
          <div class="status-indicator" data-state={bridgeStatus}>
            <span class="dot"></span>
            <span class="label">{bridgeStatusLabels[bridgeStatus]}</span>
          </div>
        {:else}
          {#each portStatuses as portStatus (portStatus.portId)}
            <div class="status-indicator" data-state={portStatus.status}>
              <span class="dot"></span>
              <span class="label">
                {portStatus.portId}: {portStatus.message ||
                  bridgeStatusLabels[portStatus.status] ||
                  bridgeStatusLabels[bridgeStatus]}
              </span>
            </div>
          {/each}
        {/if}
      </div>
      <div class="status-item">
        <div class="status-indicator" data-state={connectionStatus}>
          <span class="dot"></span>
          <span class="label">{statusMessage || 'MQTT 스트림을 기다리는 중입니다.'}</span>
        </div>
      </div>
    </div>
  </div>
</header>

<style>
  .header {
    height: 65px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 2rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
    background-color: #0f172a;
    position: sticky;
    top: 0;
    z-index: 60;
    box-sizing: border-box;
  }

  .left-section {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .logo-icon {
    width: 32px;
    height: 32px;
    background: linear-gradient(135deg, #2563eb, #7c3aed);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    color: white;
  }

  .logo-text {
    font-size: 1.1rem;
    font-weight: 700;
    color: #e2e8f0;
  }

  .mobile-menu-btn {
    display: none;
    font-size: 1.5rem;
    padding: 0.25rem 0.5rem;
    line-height: 1;
  }

  .status-container {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    align-items: flex-end;
  }

  .port-statuses {
    display: grid;
    gap: 0.25rem;
    justify-items: end;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: #94a3b8;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #64748b;
  }

  .status-indicator[data-state='started'] .dot,
  .status-indicator[data-state='connected'] .dot {
    background-color: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
  }

  .status-indicator[data-state='starting'] .dot,
  .status-indicator[data-state='connecting'] .dot {
    background-color: #f59e0b;
    animation: pulse 2s infinite;
  }

  .status-indicator[data-state='error'] .dot {
    background-color: #ef4444;
  }

  .status-indicator[data-state='error'] {
    color: #ef4444;
  }

  button.ghost {
    background: transparent;
    color: #94a3b8;
    padding: 0.5rem 1rem;
    font-size: 0.9rem;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 8px;
    cursor: pointer;
    transition: all 0.2s;
  }

  button.ghost:hover:not(:disabled) {
    background: rgba(148, 163, 184, 0.1);
    color: #e2e8f0;
    border-color: rgba(148, 163, 184, 0.4);
  }

  button.ghost:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .alpha-badge {
    background-color: #f59e0b;
    color: #fff;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: bold;
    user-select: none;
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

  @media (max-width: 768px) {
    .header {
      padding: 0 1rem;
    }

    .mobile-menu-btn {
      display: block;
    }

    .logo-text {
      display: none;
    }
  }
</style>
