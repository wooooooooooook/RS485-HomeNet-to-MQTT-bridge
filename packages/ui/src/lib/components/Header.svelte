<script lang="ts">
  import type { BridgeStatus } from '../types';

  export let bridgeStatus: BridgeStatus = 'idle';
  export let connectionStatus: 'idle' | 'connecting' | 'connected' | 'error' = 'idle';
  export let statusMessage: string;
  export let onRefresh: () => void;
  export let isRefreshing: boolean = false;

  const bridgeStatusLabels: Record<BridgeStatus, string> = {
    idle: '브리지를 준비하는 중입니다.',
    starting: '브리지를 시작하는 중입니다...',
    started: '브리지가 실행 중입니다.',
    stopped: '브리지가 중지되었습니다.',
    error: '브리지 오류가 발생했습니다.',
  };
</script>

<header class="header">
  <div class="status-container">
    <div class="status-item">
      <div class="status-indicator" data-state={bridgeStatus}>
        <span class="dot" />
        <span class="label">{bridgeStatusLabels[bridgeStatus]}</span>
      </div>
    </div>
    <div class="status-item">
      <div class="status-indicator" data-state={connectionStatus}>
        <span class="dot" />
        <span class="label">{statusMessage || 'MQTT 스트림을 기다리는 중입니다.'}</span>
      </div>
    </div>
  </div>

  <div class="controls">
    <button class="ghost" type="button" on:click={onRefresh} disabled={isRefreshing}>
      {isRefreshing ? '갱신 중...' : '정보 새로고침'}
    </button>
  </div>
</header>

<style>
  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  }

  .status-container {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: #94a3b8;
  }

  .dot {
    width: 8px;
    height: 8px;
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
