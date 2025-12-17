<script lang="ts">
  import type {
    BridgeInfo,
    UnifiedEntity,
    BridgeSerialInfo,
    ActivityLog,
    BridgeStatus,
  } from '../types';
  import EntityCard from '../components/EntityCard.svelte';
  import RecentActivity from '../components/RecentActivity.svelte';
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';

  let {
    bridgeInfo,
    infoLoading,
    infoError,
    portMetadata,
    mqttUrl,
    entities,
    selectedPortId,
    showInactive,
    activityLogs,
    connectionStatus = 'idle' as 'idle' | 'connecting' | 'connected' | 'error',
    statusMessage = '',
    portStatuses = [],
  } = $props<{
    bridgeInfo: BridgeInfo | null;
    infoLoading: boolean;
    infoError: string;
    portMetadata: Array<BridgeSerialInfo & { configFile: string }>;
    mqttUrl: string;
    entities: UnifiedEntity[];
    selectedPortId: string | null;
    showInactive: boolean;
    activityLogs: ActivityLog[];
    connectionStatus?: 'idle' | 'connecting' | 'connected' | 'error';
    statusMessage?: string;
    portStatuses?: { portId: string; status: BridgeStatus | 'unknown'; message?: string }[];
  }>();

  const dispatch = createEventDispatcher<{
    select: { entityId: string };
    toggleInactive: void;
    portChange: { portId: string };
  }>();

  const portIds = $derived.by<string[]>(() =>
    portMetadata.map((port: BridgeSerialInfo & { configFile: string }) => port.portId),
  );
  const activePortId = $derived.by<string | null>(() =>
    selectedPortId && portIds.includes(selectedPortId) ? selectedPortId : (portIds[0] ?? null),
  );
  // App.svelte에서 이미 dashboardEntities로 포트별 필터링을 완료하여 전달하므로,
  // 여기서는 전달받은 entities를 그대로 사용합니다.
  const visibleEntities = $derived.by<UnifiedEntity[]>(() => entities);

  // portStatuses에서 해당 포트의 상태를 가져오는 헬퍼 함수
  function getPortStatus(portId: string): BridgeStatus | 'unknown' {
    const portStatus = portStatuses.find(
      (p: { portId: string; status: BridgeStatus | 'unknown'; message?: string }) =>
        p.portId === portId,
    );
    return portStatus?.status ?? 'unknown';
  }

  function handleSelect(entityId: string) {
    dispatch('select', { entityId });
  }

  const parseStatusMessage = (msg: string | undefined) => {
    if (!msg) return { key: 'dashboard.mqtt_waiting', values: {} };
    try {
      const parsed = JSON.parse(msg);
      if (parsed && typeof parsed === 'object' && parsed.key) {
        return { key: parsed.key, values: parsed.values || {} };
      }
    } catch {}
    // If not JSON, return as key with no values
    return { key: msg, values: {} };
  };
</script>

<div class="dashboard-view">
  {#if infoLoading && !bridgeInfo && !infoError}
    <div class="loading-state">
      <p class="hint">{$t('dashboard.loading_bridge')}</p>
    </div>
  {:else if infoError}
    <div class="error-state">
      <p class="error">{infoError}</p>
    </div>
  {:else if !bridgeInfo}
    <div class="empty-state">
      <p class="empty">{$t('dashboard.no_bridge_info')}</p>
    </div>
  {:else}
    <!-- Minimized Metadata Section with MQTT Status -->
    <div class="viewer-meta-mini">
      <div class="mqtt-info">
        <span class="label">{$t('dashboard.mqtt_label')}</span>
        <strong>{mqttUrl}</strong>
      </div>
      <div class="mqtt-status" data-state={connectionStatus}>
        <span class="dot"></span>
        {#if statusMessage}
          {@const status = parseStatusMessage(statusMessage)}
          <span class="status-text">{$t(status.key, { values: status.values })}</span>
        {:else}
          <span class="status-text">{$t('dashboard.mqtt_waiting')}</span>
        {/if}
      </div>
    </div>

    {#if bridgeInfo.error}
      <div class="bridge-error">
        <p class="error subtle">
          {$t('dashboard.bridge_error', { values: { error: $t(`errors.${bridgeInfo.error}`) } })}
        </p>
      </div>
    {/if}

    <!-- Toolbar Section -->
    <div class="dashboard-toolbar">
      <div class="port-tabs" aria-label={$t('dashboard.port_tabs_aria')}>
        {#if portIds.length === 0}
          <span class="hint">{$t('dashboard.no_configured_ports')}</span>
        {:else}
          {#each portIds as portId (portId)}
            <button
              class:active={activePortId === portId}
              type="button"
              onclick={() => dispatch('portChange', { portId })}
              data-state={getPortStatus(portId)}
            >
              <span class="port-status-dot"></span>
              {portId}
            </button>
          {/each}
        {/if}
      </div>
      <label class="toggle-switch">
        <input type="checkbox" checked={showInactive} onchange={() => dispatch('toggleInactive')} />
        <span class="slider"></span>
        {$t('dashboard.show_inactive_entities')}
      </label>
    </div>

    <!-- Port-specific Details Section -->
    <div class="port-details-container">
      {#if activePortId}
        <!-- Minimized Port Metadata -->
        {#each portMetadata.filter((p: BridgeSerialInfo & { configFile: string }) => p.portId === activePortId) as port (port.portId)}
          <div class="port-meta-mini">
            <div class="meta-item">
              <strong>{$t('dashboard.port_meta.path')}</strong> <span>{port.path || 'N/A'}</span>
            </div>
            <div class="meta-item">
              <strong>{$t('dashboard.port_meta.baud')}</strong> <span>{port.baudRate}</span>
            </div>
            <div class="meta-item">
              <strong>{$t('dashboard.port_meta.file')}</strong> <span>{port.configFile}</span>
            </div>
          </div>
        {/each}

        <!-- Recent Activity Section -->
        <RecentActivity activities={activityLogs} />
      {/if}
    </div>

    <!-- Entity Grid Section -->
    <div class="entity-grid">
      {#if visibleEntities.length === 0 && !infoLoading}
        <div class="empty-grid">
          <p class="empty full-width">{$t('dashboard.no_devices_found')}</p>
        </div>
      {:else}
        {#each visibleEntities as entity (entity.id)}
          <EntityCard {entity} on:select={() => handleSelect(entity.id)} />
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .dashboard-view {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .viewer-meta-mini {
    font-size: 0.8rem;
    padding: 0.5rem 1rem;
    border-radius: 8px;
    background: rgba(30, 41, 59, 0.7);
    border: 1px solid rgba(148, 163, 184, 0.1);
    color: #94a3b8;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .mqtt-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .mqtt-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
  }

  .mqtt-status .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #64748b;
    flex-shrink: 0;
  }

  .mqtt-status[data-state='connected'] .dot {
    background-color: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.4);
  }

  .mqtt-status[data-state='connecting'] .dot {
    background-color: #f59e0b;
    animation: pulse 2s infinite;
  }

  .mqtt-status[data-state='error'] .dot {
    background-color: #ef4444;
  }

  .mqtt-status[data-state='error'] {
    color: #ef4444;
  }

  .mqtt-status .status-text {
    color: #94a3b8;
  }

  .mqtt-status[data-state='connected'] .status-text {
    color: #10b981;
  }

  .mqtt-status[data-state='error'] .status-text {
    color: #ef4444;
  }

  .viewer-meta-mini strong {
    color: #cbd5e1;
    font-weight: 600;
    font-family: monospace;
    word-break: break-all;
  }

  .port-details-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    width: 100%;
  }

  .port-meta-mini {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 2rem;
    font-size: 0.85rem;
    padding: 1rem;
    border-radius: 8px;
    background: rgba(30, 41, 59, 0.5);
    border: 1px solid rgba(148, 163, 184, 0.1);
    box-sizing: border-box;
    width: 100%;
  }

  .meta-item {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .meta-item strong {
    color: #94a3b8;
    flex-shrink: 0;
    font-weight: 600;
  }

  .meta-item span {
    color: #f1f5f9;
    word-break: break-all;
    font-family: monospace;
    font-size: 0.9rem;
  }

  .label {
    font-size: 0.85rem;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }

  strong {
    color: #f1f5f9;
    font-size: 1rem;
    font-family: monospace;
    word-break: break-all;
  }

  .bridge-error {
    margin-top: 1rem;
  }

  .error {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }

  .entity-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
    gap: 1.5rem;
  }

  .hint,
  .empty {
    color: #94a3b8;
    font-style: italic;
    text-align: center;
    padding: 2rem;
  }
  .dashboard-toolbar {
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

  .toggle-switch {
    position: relative;
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    font-size: 0.9rem;
    color: #cbd5e1;
    gap: 0.5rem;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    width: 36px;
    height: 20px;
    background-color: #334155;
    border-radius: 10px;
    transition: background-color 0.2s;
    margin-right: 0.25rem;
    position: relative;
  }

  .slider:before {
    content: '';
    position: absolute;
    height: 14px;
    width: 14px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    border-radius: 50%;
    transition: transform 0.2s;
  }

  input:checked + .slider {
    background-color: #3b82f6;
  }

  input:checked + .slider:before {
    transform: translateX(16px);
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
