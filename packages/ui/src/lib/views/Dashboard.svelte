<script lang="ts">
  import type {
    BridgeInfo,
    UnifiedEntity,
    BridgeSerialInfo,
    ActivityLog,
    BridgeStatus,
    StatusMessage,
    EntityCategory,
    BridgeErrorPayload,
  } from '../types';
  import EntityCard from '../components/EntityCard.svelte';
  import RecentActivity from '../components/RecentActivity.svelte';
  import SetupWizard from '../components/SetupWizard.svelte';

  import HintBubble from '$lib/components/HintBubble.svelte';
  import PortToolbar from '$lib/components/PortToolbar.svelte';
  import { t } from 'svelte-i18n';

  import Button from '$lib/components/Button.svelte';

  let {
    bridgeInfo,
    infoLoading,
    infoError,
    portMetadata,
    mqttUrl,
    entities,
    selectedPortId,
    showInactive,
    showEntities,
    showAutomations,
    showScripts,
    hasInactiveEntities = false,
    activityLogs,
    connectionStatus = 'idle' as 'idle' | 'connecting' | 'connected' | 'error',
    statusMessage = null,
    portStatuses = [],
    onSelect,
    onToggleInactive,
    onToggleEntities,
    onToggleAutomations,
    onToggleScripts,
    onPortChange,
  }: {
    bridgeInfo: BridgeInfo | null;
    infoLoading: boolean;
    infoError: string;
    portMetadata: Array<
      BridgeSerialInfo & {
        configFile: string;
        error?: string;
        errorInfo?: BridgeErrorPayload | null;
        status?: 'idle' | 'starting' | 'started' | 'error' | 'stopped';
      }
    >;
    mqttUrl: string;
    entities: UnifiedEntity[];
    selectedPortId: string | null;
    showInactive: boolean;
    showEntities: boolean;
    showAutomations: boolean;
    showScripts: boolean;
    hasInactiveEntities?: boolean;
    activityLogs: ActivityLog[];
    connectionStatus?: 'idle' | 'connecting' | 'connected' | 'error';
    statusMessage?: StatusMessage | null;
    portStatuses?: {
      portId: string;
      status: BridgeStatus | 'unknown';
      message?: string;
      errorInfo?: BridgeErrorPayload | null;
    }[];
    onSelect?: (entityId: string, portId: string | undefined, category: EntityCategory) => void;
    onToggleInactive?: () => void;
    onToggleEntities?: () => void;
    onToggleAutomations?: () => void;
    onToggleScripts?: () => void;
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
      (p: {
        portId: string;
        status: BridgeStatus | 'unknown';
        message?: string;
        errorInfo?: BridgeErrorPayload | null;
      }) => p.portId === portId,
    );
    if (portStatus?.errorInfo) {
      return $t(`errors.${portStatus.errorInfo.code}`, {
        default:
          portStatus.errorInfo.message || portStatus.errorInfo.detail || portStatus.errorInfo.code,
      });
    }
    return portStatus?.message;
  }

  function getBridgeErrorMessage(): string | undefined {
    if (!bridgeInfo?.errorInfo) return bridgeInfo?.error ? $t(`errors.${bridgeInfo.error}`) : '';
    return $t(`errors.${bridgeInfo.errorInfo.code}`, {
      default:
        bridgeInfo.errorInfo.message || bridgeInfo.errorInfo.detail || bridgeInfo.errorInfo.code,
    });
  }

  function getPortMetadataErrorMessage(
    port?: BridgeSerialInfo & {
      error?: string;
      errorInfo?: BridgeErrorPayload | null;
    },
  ): string | undefined {
    if (!port) return undefined;
    if (port.errorInfo) {
      return $t(`errors.${port.errorInfo.code}`, {
        default: port.errorInfo.message || port.errorInfo.detail || port.errorInfo.code,
      });
    }
    if (port.error) {
      return $t(`errors.${port.error}`, { default: port.error });
    }
    return undefined;
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
      <div class="error-actions">
        <Button variant="primary" onclick={() => window.location.reload()}>
          {$t('common.retry')}
        </Button>
      </div>
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
          {$t('dashboard.bridge_error', { values: { error: getBridgeErrorMessage() } })}
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
            <div class="meta-item">
              <span class="label">{$t('dashboard.port_meta.status')}</span>
              <span class="value bridge-status-value" data-state={getPortStatus(activePortId)}>
                <span class="status-dot"></span>
                {$t(`common.status.${getPortStatus(activePortId)}`)}
              </span>
            </div>
          </div>
        {/if}
        {#if getPortStatus(activePortId) === 'error' && (getPortErrorMessage(activePortId) || getPortMetadataErrorMessage(activePortMetadata))}
          <div class="port-error">
            <span class="error-text">
              {$t('dashboard.port_error', {
                values: {
                  error:
                    getPortErrorMessage(activePortId) ||
                    getPortMetadataErrorMessage(activePortMetadata),
                },
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
    <div class="toggle-container" aria-label={$t('dashboard.filter_section_aria')}>
      <div class="toggle-header">
        <span class="toggle-title">{$t('dashboard.filter_title')}</span>
      </div>
      {#if hasInactiveEntities && !hintDismissed}
        <HintBubble onDismiss={() => (hintDismissed = true)} autoCloseMs={10000}>
          {$t('dashboard.hint_inactive_performance')}
        </HintBubble>
      {/if}
      <div class="toggle-group">
        <button
          type="button"
          class:active={showEntities}
          class="filter-chip"
          aria-pressed={showEntities}
          onclick={() => onToggleEntities?.()}
        >
          {$t('dashboard.show_entities')}
        </button>
        <button
          type="button"
          class:active={showAutomations}
          class="filter-chip"
          aria-pressed={showAutomations}
          onclick={() => onToggleAutomations?.()}
        >
          {$t('dashboard.show_automations')}
        </button>
        <button
          type="button"
          class:active={showScripts}
          class="filter-chip"
          aria-pressed={showScripts}
          onclick={() => onToggleScripts?.()}
        >
          {$t('dashboard.show_scripts')}
        </button>
        <button
          type="button"
          class:active={showInactive}
          class="filter-chip"
          aria-pressed={showInactive}
          onclick={() => onToggleInactive?.()}
        >
          {$t('dashboard.show_inactive_entities')}
        </button>
      </div>
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

  .toggle-container {
    position: relative;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;
  }

  .toggle-header {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.15rem;
    text-align: right;
  }

  .toggle-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: #e2e8f0;
  }

  .toggle-group {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .filter-chip {
    border: 1px solid rgba(148, 163, 184, 0.35);
    border-radius: 999px;
    padding: 0.35rem 0.7rem;
    background: rgba(15, 23, 42, 0.6);
    color: #cbd5f5;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .filter-chip:hover {
    border-color: rgba(148, 163, 184, 0.6);
    color: #e2e8f0;
  }

  .filter-chip.active {
    border-color: rgba(59, 130, 246, 0.7);
    background: rgba(59, 130, 246, 0.2);
    color: #eff6ff;
    box-shadow: 0 0 12px rgba(59, 130, 246, 0.2);
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

  .error-actions {
    margin-top: 1rem;
    display: flex;
    justify-content: center;
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

  /* Bridge Status Styles */
  .bridge-status-value {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .bridge-status-value .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: #64748b;
  }

  .bridge-status-value[data-state='started'] .status-dot {
    background-color: #10b981;
    box-shadow: 0 0 6px rgba(16, 185, 129, 0.4);
  }

  .bridge-status-value[data-state='starting'] .status-dot {
    background-color: #f59e0b;
    animation: pulse 2s infinite;
  }

  .bridge-status-value[data-state='reconnecting'] .status-dot {
    background-color: #f59e0b;
    animation: pulse 1s infinite;
  }

  .bridge-status-value[data-state='error'] .status-dot {
    background-color: #ef4444;
  }

  .bridge-status-value[data-state='started'] {
    color: #10b981;
  }

  .bridge-status-value[data-state='reconnecting'] {
    color: #f59e0b;
  }

  .bridge-status-value[data-state='error'] {
    color: #ef4444;
  }
</style>
