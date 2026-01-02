<script lang="ts">
  import type {
    BridgeInfo,
    UnifiedEntity,
    BridgeSerialInfo,
    ActivityLog,
    BridgeStatus,
    StatusMessage,
    EntityCategory,
  } from '../types';
  import EntityCard from '../components/EntityCard.svelte';
  import RecentActivity from '../components/RecentActivity.svelte';
  import SetupWizard from '../components/SetupWizard.svelte';

  import HintBubble from '$lib/components/HintBubble.svelte';
  import Toggle from '$lib/components/Toggle.svelte';
  import PortToolbar from '$lib/components/PortToolbar.svelte';
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
    hasInactiveEntities = false,
    activityLogs,
    connectionStatus = 'idle' as 'idle' | 'connecting' | 'connected' | 'error',
    statusMessage = null,
    portStatuses = [],
    onSelect,
    onToggleInactive,
    onPortChange,
  }: {
    bridgeInfo: BridgeInfo | null;
    infoLoading: boolean;
    infoError: string;
    portMetadata: Array<
      BridgeSerialInfo & {
        configFile: string;
        error?: string;
        status?: 'idle' | 'starting' | 'started' | 'error' | 'stopped';
      }
    >;
    mqttUrl: string;
    entities: UnifiedEntity[];
    selectedPortId: string | null;
    showInactive: boolean;
    hasInactiveEntities?: boolean;
    activityLogs: ActivityLog[];
    connectionStatus?: 'idle' | 'connecting' | 'connected' | 'error';
    statusMessage?: StatusMessage | null;
    portStatuses?: { portId: string; status: BridgeStatus | 'unknown'; message?: string }[];
    onSelect?: (entityId: string, portId: string | undefined, category: EntityCategory) => void;
    onToggleInactive?: () => void;
    onPortChange?: (portId: string) => void;
  } = $props();

  const portIds = $derived.by<string[]>(() =>
    portMetadata.map(
      (
        port: BridgeSerialInfo & {
          configFile: string;
          error?: string;
          status?: 'idle' | 'starting' | 'started' | 'error' | 'stopped';
        },
      ) => port.portId,
    ),
  );
  const activePortId = $derived.by<string | null>(() =>
    selectedPortId && portIds.includes(selectedPortId) ? selectedPortId : (portIds[0] ?? null),
  );
  // App.svelte에서 이미 dashboardEntities로 포트별 필터링을 완료하여 전달하므로,
  // 여기서는 전달받은 entities를 그대로 사용합니다.
  const visibleEntities = $derived.by<UnifiedEntity[]>(() => entities);
  let hintDismissed = $state(false);
  let showAddBridgeModal = $state(false);

  // portStatuses에서 해당 포트의 상태를 가져오는 헬퍼 함수
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

  function handleSelect(entityId: string, portId: string | undefined, category: EntityCategory) {
    onSelect?.(entityId, portId, category);
  }
</script>

<div class="dashboard-view">
  {#if infoLoading && !bridgeInfo && !infoError}
    <div class="loading-state">
      <p class="hint">{$t('dashboard.loading_bridge')}</p>
    </div>
  {:else if infoError === 'CONFIG_INITIALIZATION_REQUIRED'}
    <SetupWizard oncomplete={() => window.location.reload()} />
  {:else if infoError}
    <div class="error-state">
      <p class="error">{$t(`errors.${infoError}`)}</p>
    </div>
  {:else if !bridgeInfo}
    <div class="empty-state">
      <p class="empty">{$t('dashboard.no_bridge_info')}</p>
    </div>
  {:else if bridgeInfo.error === 'CONFIG_INITIALIZATION_REQUIRED'}
    <SetupWizard oncomplete={() => window.location.reload()} />
  {:else if bridgeInfo.restartRequired}
    <SetupWizard oncomplete={() => window.location.reload()} />
  {:else}
    {#if bridgeInfo.error}
      <div class="bridge-error">
        <p class="error subtle">
          {$t('dashboard.bridge_error', { values: { error: $t(`errors.${bridgeInfo.error}`) } })}
        </p>
      </div>
    {/if}

    <!-- Toolbar Section -->
    <PortToolbar
      {portIds}
      {activePortId}
      {portStatuses}
      showAddButton={true}
      {onPortChange}
      onAddBridge={() => (showAddBridgeModal = true)}
    />

    <!-- Compact Info Panel -->
    <div class="info-panel">
      <div class="info-row">
        <div class="mqtt-info">
          <span class="label">{$t('dashboard.mqtt_label')}</span>
          <span class="value">{mqttUrl}</span>
        </div>
        <div class="mqtt-status" data-state={connectionStatus}>
          <span class="dot"></span>
          {#if statusMessage}
            <span class="status-text"
              >{$t(statusMessage.key, { values: statusMessage.values })}</span
            >
          {:else}
            <span class="status-text">{$t('dashboard.mqtt_waiting')}</span>
          {/if}
        </div>
      </div>
      {#if activePortId}
        {@const activePortMetadata = portMetadata.find((p) => p.portId === activePortId)}
        {#if activePortMetadata && (activePortMetadata.path || activePortMetadata.configFile)}
          <div class="info-row port-info">
            <div class="meta-item">
              <span class="label">{$t('dashboard.port_meta.file')}</span>
              <span class="value">{activePortMetadata.configFile}</span>
            </div>
            <div class="meta-item">
              <span class="label">{$t('dashboard.port_meta.path')}</span>
              <span class="value">{activePortMetadata.path || 'N/A'}</span>
            </div>
          </div>
        {/if}
        {#if getPortStatus(activePortId) === 'error' && (getPortErrorMessage(activePortId) || activePortMetadata?.error)}
          <div class="port-error">
            <span class="error-text">
              {$t('dashboard.port_error', {
                values: { error: getPortErrorMessage(activePortId) || activePortMetadata?.error },
              })}
            </span>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Recent Activity Section -->
    {#if activePortId}
      <RecentActivity activities={activityLogs} />
    {/if}

    <!-- Toggle for Inactive Entities -->
    <div
      class="toggle-container"
      style="position: relative; display: flex; justify-content: flex-end;"
    >
      {#if hasInactiveEntities && !hintDismissed}
        <HintBubble onDismiss={() => (hintDismissed = true)} autoCloseMs={10000}>
          {$t('dashboard.hint_inactive_performance')}
        </HintBubble>
      {/if}
      <Toggle
        checked={showInactive}
        onchange={onToggleInactive}
        label={$t('dashboard.show_inactive_entities')}
      />
    </div>

    <!-- Entity Grid Section -->
    <div class="entity-grid">
      {#if visibleEntities.length === 0 && !infoLoading}
        <div class="empty-grid">
          <p class="empty full-width">{$t('dashboard.no_devices_found')}</p>
        </div>
      {:else}
        {#each visibleEntities as entity (entity.id + '-' + (entity.portId || 'unknown') + '-' + (entity.category || 'entity'))}
          <EntityCard
            {entity}
            onSelect={() => handleSelect(entity.id, entity.portId, entity.category ?? 'entity')}
          />
        {/each}
      {/if}
    </div>
  {/if}

  {#if showAddBridgeModal}
    <SetupWizard mode="add" onclose={() => (showAddBridgeModal = false)} />
  {/if}
</div>

<style>
  .dashboard-view {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .info-panel {
    font-size: 0.9rem;
    padding: 0.4rem 0.8rem;
    border-radius: 6px;
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid rgba(148, 163, 184, 0.1);
    color: #94a3b8;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .info-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .info-row.port-info {
    gap: 1.5rem;
    justify-content: flex-start;
  }

  .mqtt-info {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .label {
    color: #64748b;
    font-weight: 500;
  }

  .value {
    color: #cbd5e1;
    font-family: monospace;
    font-size: 0.9rem;
  }

  .mqtt-status {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .mqtt-status .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background-color: #64748b;
    flex-shrink: 0;
  }

  .mqtt-status[data-state='connected'] .dot {
    background-color: #10b981;
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.4);
  }

  .mqtt-status[data-state='connecting'] .dot {
    background-color: #f59e0b;
    animation: pulse 2s infinite;
  }

  .mqtt-status[data-state='error'] .dot {
    background-color: #ef4444;
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

  .port-error {
    padding-top: 0.2rem;
  }

  .port-error .error-text {
    color: #ef4444;
    font-size: 0.65rem;
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

  .bridge-error {
    margin-top: 1rem;
  }

  .port-error {
    margin-bottom: 0.5rem;
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
</style>
